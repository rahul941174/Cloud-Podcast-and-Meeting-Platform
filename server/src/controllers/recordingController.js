import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.join(__dirname, "../uploads/recordings");
const OUTPUT_DIR = path.join(__dirname, "../uploads/final");

// Ensure output folder exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });


// ---------------------------
//  FIX #2 — NORMALIZE VIDEO
// ---------------------------
const normalizeVideo = (input, output) => {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        '-vf scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        '-r 30',
        '-c:v libvpx-vp9',
        '-b:v 1M',
        '-ac 2'
      ])
      .on("end", () => resolve(output))
      .on("error", reject)
      .save(output);
  });
};


// ---------------------------
//   CONCAT USER CHUNKS
// ---------------------------
const concatChunks = async (folderPath, outputFile) => {
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith(".webm"));

  files.sort((a, b) => {
    const numA = parseInt(a.split("_")[1]);
    const numB = parseInt(b.split("_")[1]);
    return numA - numB;
  });

  if (files.length === 1) {
    // No need to concat, just copy
    fs.copyFileSync(path.join(folderPath, files[0]), outputFile);
    return outputFile;
  }

  const concatList = path.join(folderPath, "concat.txt");
  fs.writeFileSync(concatList, files.map(f => `file '${path.join(folderPath, f)}'`).join("\n"));

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatList)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .on("end", () => resolve(outputFile))
      .on("error", reject)
      .save(outputFile);
  });
};


// ---------------------------
//  FIX #3 — MERGE FINAL MP4
// ---------------------------
const mergeFinalVideo = async (videos, outputFile) => {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    videos.forEach(v => command.input(v));

    command
      .complexFilter(`hstack=inputs=${videos.length}`)
      .outputOptions([
        "-c:v libx264",
        "-preset veryfast",
        "-crf 23",
        "-pix_fmt yuv420p"
      ])
      .on("end", () => resolve(outputFile))
      .on("error", reject)
      .save(outputFile);
  });
};


// ---------------------------
//  FIX #4 — CLEANUP
// ---------------------------
const cleanupChunks = (roomPath) => {
  try {
    fs.rmSync(roomPath, { recursive: true, force: true });
    console.log(`🧹 Cleaned temporary chunks in ${roomPath}`);
  } catch (err) {
    console.error("Cleanup failed:", err);
  }
};


// ---------------------------
//   MAIN MERGE HANDLER
// ---------------------------
export const mergeRecording = async (req, res) => {
  const { roomId } = req.body;

  try {
    const roomPath = path.join(BASE_DIR, roomId);
    const users = fs.readdirSync(roomPath);

    const normalizedVideos = [];

    for (const userId of users) {
      const userDir = path.join(roomPath, userId);

      const rawOutput = path.join(userDir, "combined.webm");
      const normalizedOutput = path.join(userDir, "normalized.webm");

      // 1️⃣ Combine chunks
      await concatChunks(userDir, rawOutput);

      // 2️⃣ Normalize video for merge
      await normalizeVideo(rawOutput, normalizedOutput);

      normalizedVideos.push(normalizedOutput);
    }

    // 3️⃣ Merge into side-by-side mp4
    const finalOutputPath = path.join(
      OUTPUT_DIR,
      `${roomId}_final_${Date.now()}.mp4`
    );

    await mergeFinalVideo(normalizedVideos, finalOutputPath);

    // 4️⃣ Cleanup original chunks
    cleanupChunks(roomPath);

    res.json({ success: true, file: finalOutputPath });

  } catch (error) {
    console.error("❌ Merge error:", error);
    res.status(500).json({ error: "Failed to merge video", details: error.message });
  }
};
