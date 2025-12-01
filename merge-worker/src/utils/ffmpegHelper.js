// merge-worker/src/utils/ffmpegHelper.js
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { RECORDINGS_DIR } from "./fileHelper.js";

ffmpeg.setFfmpegPath(ffmpegPath);

// -----------------------------
// Helper: validate a .webm chunk using ffprobe
// -----------------------------
export function validateChunk(chunkPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(chunkPath, (err, metadata) => {
      if (err) {
        console.warn("❌ ffprobe failed for", chunkPath, err.message || err);
        return resolve(false);
      }

      const hasVideo = metadata.streams.some((s) => s.codec_type === "video");
      const hasAudio = metadata.streams.some((s) => s.codec_type === "audio");

      if (!hasVideo && !hasAudio) {
        console.warn("⚠️ Chunk missing audio/video:", chunkPath);
        return resolve(false);
      }

      resolve(true);
    });
  });
}

// -----------------------------
// Get sorted chunks for a user folder
// Format expected: "<timestamp>-<index>.webm" OR any lexicographic-safe name
// -----------------------------
export async function getSortedChunks(userDir) {
  if (!fs.existsSync(userDir)) return [];

  const files = fs.readdirSync(userDir).filter((f) => f.endsWith(".webm"));

  // Attempt to sort by numeric prefix before dot or dash (timestamp-index.webm)
  files.sort((a, b) => {
    const aKey = a.split(".")[0].split("-")[0];
    const bKey = b.split(".")[0].split("-")[0];
    const aNum = Number(aKey);
    const bNum = Number(bKey);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
    // fallback to mtime
    const aM = fs.statSync(path.join(userDir, a)).mtimeMs;
    const bM = fs.statSync(path.join(userDir, b)).mtimeMs;
    return aM - bM;
  });

  const valid = [];
  for (const f of files) {
    const full = path.join(userDir, f);
    try {
      const stat = fs.statSync(full);
      if (stat.size < 1500) {
        console.warn("⚠️ Skipping tiny chunk:", full);
        continue;
      }
    } catch (e) {
      continue;
    }

    const ok = await validateChunk(full);
    if (ok) valid.push(full);
  }

  return valid;
}

// -----------------------------
// Normalize a single chunk -> CFR MP4
// Produces a stable MP4 with regenerated timestamps and fixed fps.
// -----------------------------
export function normalizeChunk(inputPath, outputPath, opts = {}) {
  const FPS = opts.fps || 30;

  return new Promise((resolve, reject) => {
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    try {
      if (fs.existsSync(outputPath)) {
        const st = fs.statSync(outputPath);
        if (st.size === 0) fs.unlinkSync(outputPath);
      }
    } catch (e) {}

    ffmpeg(inputPath)
      .outputOptions([
        "-vf", `fps=${FPS},setpts=N/${FPS}/TB,format=yuv420p`,
        "-vsync", "1",

        //  HIGH QUALITY VIDEO SETTINGS
        "-c:v", "libx264",
        "-preset", "slower",     // better quality than veryfast
        "-crf", "14",            // HIGH QUALITY (lower = better)
        "-profile:v", "high",    // use high profile (best quality)
        "-pix_fmt", "yuv420p",

        // HIGH QUALITY AUDIO
        "-c:a", "aac",
        "-b:a", "256k",

        "-movflags", "+faststart",
      ])
      .on("end", () => {
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
          resolve(outputPath);
        } else {
          reject(new Error("normalizeChunk produced empty file"));
        }
      })
      .on("error", (err) => {
        console.error("❌ normalizeChunk ffmpeg error:", err);
        reject(err);
      })
      .save(outputPath);
  });
}


// -----------------------------
// Concatenate user's webm chunks into a single MP4 (clean CFR)
// Returns output path
// Changes: NORMALIZE each chunk first then concat the normalized mp4s.
// -----------------------------
export async function concatUserChunks(roomId, userId) {
  const userDir = path.join(RECORDINGS_DIR, roomId, userId);
  if (!fs.existsSync(userDir)) {
    throw new Error(`User directory not found: ${userDir}`);
  }

  const chunks = await getSortedChunks(userDir);
  if (chunks.length === 0) {
    throw new Error(`No valid chunks for user ${userId}`);
  }

  // normalize each chunk into userDir/<origname>-norm.mp4
  const normalizedFiles = [];
  for (const c of chunks) {
    const base = path.basename(c, path.extname(c)); // e.g. 1700000000000-0
    const normalized = path.join(userDir, `${base}-norm.mp4`);

    // If normalized file already exists and looks valid, skip normalization (speed)
    if (fs.existsSync(normalized)) {
      try {
        if (fs.statSync(normalized).size > 1000) {
          normalizedFiles.push(normalized);
          continue;
        } else {
          // remove tiny stale file
          fs.unlinkSync(normalized);
        }
      } catch (e) {
        // fall-through to normalization
      }
    }

    console.log(`🔧 Normalizing chunk: ${c} → ${normalized}`);
    await normalizeChunk(c, normalized);
    normalizedFiles.push(normalized);
  }

  // write concat list using normalized mp4s
  const listFile = path.join(userDir, "concat.txt");
  const listContent = normalizedFiles
    .map((c) => `file '${c.replace(/\\/g, "/")}'`)
    .join("\n");
  fs.writeFileSync(listFile, listContent);

  const output = path.join(RECORDINGS_DIR, roomId, `user-${userId}-merged.mp4`);

  console.log(`🎬 Concatenating ${normalizedFiles.length} normalized chunks for user ${userId} → ${output}`);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(["-f concat", "-safe 0"])
      // re-encode final per-user file to ensure uniform settings
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "160k",
        "-movflags", "+faststart",
      ])
      .on("end", () => {
        console.log(`✅ User merged file created → ${output}`);
        resolve(output);
      })
      .on("error", (err) => {
        console.error("❌ concatUserChunks ffmpeg error:", err);
        reject(err);
      })
      .save(output);
  });
}

// -----------------------------
// Merge multiple user MP4s into final side-by-side (or single re-encode)
// userVideos: array of file paths
// Returns final output path
// -----------------------------
export function mergeUsersFinal(roomId, userVideos) {
  const output = path.join(RECORDINGS_DIR, roomId, "final-recording.mp4");

  if (userVideos.length === 1) {
    // Single user: re-encode / normalize only
    return new Promise((resolve, reject) => {
      ffmpeg(userVideos[0])
        .outputOptions([
          "-c:v libx264",
          "-preset veryfast",
          "-crf 18",
          "-c:a aac",
          "-b:a 160k",
          "-movflags +faststart",
        ])
        .save(output)
        .on("end", () => {
          console.log("✅ Final (single-user) ready:", output);
          resolve(output);
        })
        .on("error", (err) => {
          console.error("❌ mergeUsersFinal(single) error:", err);
          reject(err);
        });
    });
  }

  // Multi-user: build complex filter: [0:v][1:v]...[N-1:v]hstack=inputs=N[vout]; [0:a][1:a]...amix=inputs=N[aout]
  const videoInputs = userVideos.map((_, i) => `[${i}:v]`).join("");
  const audioInputs = userVideos.map((_, i) => `[${i}:a]`).join("");
  const filters = [
    `${videoInputs}hstack=inputs=${userVideos.length}[vout]`,
    `${audioInputs}amix=inputs=${userVideos.length}:dropout_transition=2[aout]`,
  ];

  const cmd = ffmpeg();
  userVideos.forEach((v) => cmd.input(v));

  return new Promise((resolve, reject) => {
    cmd
      .complexFilter(filters)
      .outputOptions([
        "-map", "[vout]",
        "-map", "[aout]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "160k",
        "-movflags", "+faststart",
      ])
      .save(output)
      .on("end", () => {
        console.log("🎉 Final merged video ready:", output);
        resolve(output);
      })
      .on("error", (err) => {
        console.error("❌ mergeUsersFinal error:", err);
        reject(err);
      });
  });
}

// -----------------------------
// Main: processMeeting(roomId)
// - loops over users (directories inside RECORDINGS_DIR/roomId)
// - creates per-user merged MP4s
// - merges them into final-recording.mp4
// - returns final output path (string)
// -----------------------------
export async function processMeeting(roomId) {
  const roomDir = path.join(RECORDINGS_DIR, roomId);
  if (!fs.existsSync(roomDir)) {
    throw new Error(`Meeting directory not found: ${roomDir}`);
  }

  const entries = fs.readdirSync(roomDir);
  const userDirs = entries.filter((e) => {
    try {
      return fs.statSync(path.join(roomDir, e)).isDirectory();
    } catch {
      return false;
    }
  });

  if (userDirs.length === 0) {
    throw new Error("No user directories found for meeting");
  }

  const mergedUserVideos = [];

  for (const userId of userDirs) {
    console.log(`🔁 Processing user ${userId} chunks...`);
    const merged = await concatUserChunks(roomId, userId);
    mergedUserVideos.push(merged);
  }

  const finalPath = await mergeUsersFinal(roomId, mergedUserVideos);

  // (Optional) keep temp mp4s and chunk dirs for debugging — but we can delete if desired.
  // Here we keep them by default. If you want auto-clean, uncomment below.

  // // cleanup user folders
  // for (const u of userDirs) {
  //   fs.rmSync(path.join(roomDir, u), { recursive: true, force: true });
  // }
  // // cleanup user merged mp4s
  // for (const m of mergedUserVideos) {
  //   if (fs.existsSync(m)) fs.unlinkSync(m);
  // }

  return finalPath;
}

// Default export for backwards-compatibility
export default {
  validateChunk,
  getSortedChunks,
  concatUserChunks,
  mergeUsersFinal,
  processMeeting,
};
