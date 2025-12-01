// server/src/utils/ffmpegHelper.js

import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { getMeetingDir } from "./fileHelper.js";

// OPTIONAL: uncomment if using ffmpeg-static
// import ffmpegPath from "ffmpeg-static";
// ffmpeg.setFfmpegPath(ffmpegPath);

/*
-------------------------------------------
 GLOBAL QUALITY SETTINGS
-------------------------------------------
*/
const VIDEO_FPS = 30;             // constant frame rate
const VIDEO_BITRATE = "3500k";    // ~3.5 Mbps (high quality)
const AUDIO_BITRATE = "192k";     // high-quality AAC audio

/*
-------------------------------------------
 Validate chunks using ffprobe
-------------------------------------------
*/
export const validateChunk = (chunkPath) => {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(chunkPath, (err, metadata) => {
      if (err) return resolve(false);

      const hasVideo = metadata.streams.some((s) => s.codec_type === "video");
      const hasAudio = metadata.streams.some((s) => s.codec_type === "audio");

      resolve(hasVideo || hasAudio);
    });
  });
};

/*
-------------------------------------------
 Get sorted valid chunks
-------------------------------------------
*/
export const getValidChunkFiles = async (userDir) => {
  const files = fs.readdirSync(userDir).filter((f) => f.endsWith(".webm"));

  // FIX: correctly extract numeric timestamp BEFORE hyphen (e.g. 1700000000000-0.webm)
  files.sort((a, b) => {
    const ta = parseInt(a.split(".")[0].split("-")[0], 10);
    const tb = parseInt(b.split(".")[0].split("-")[0], 10);
    // fallback to lexicographic if parseInt fails
    if (Number.isNaN(ta) || Number.isNaN(tb)) return a.localeCompare(b);
    return ta - tb;
  });

  const valid = [];

  for (const f of files) {
    const full = path.join(userDir, f);
    // skip 0-byte or tiny files
    try {
      const st = fs.statSync(full);
      if (!st || st.size < 16) continue;
    } catch (e) {
      continue;
    }

    const ok = await validateChunk(full);
    if (ok) valid.push(f);
  }

  return valid;
};

/*
-------------------------------------------
 STEP 1: CONCAT CHUNKS → CLEAN CFR MP4
-------------------------------------------
*/
export const concatUserChunks = async (roomId, userId) => {
  const meetingDir = getMeetingDir(roomId);
  const userDir = path.join(meetingDir, userId);

  const chunks = await getValidChunkFiles(userDir);
  if (chunks.length === 0) throw new Error(`No valid chunks for user ${userId}`);

  // Build concat list (use forward slashes for ffmpeg)
  const listFile = path.join(userDir, "concat.txt");
  const lines = chunks.map(f => `file '${path.join(userDir, f).replace(/\\/g, "/")}'`);
  fs.writeFileSync(listFile, lines.join("\n"));

  const output = path.join(meetingDir, `user-${userId}.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      // use concat demuxer and ensure timestamps regenerated
      .inputOptions([
        "-f concat",
        "-safe 0",
        "-fflags +genpts",
        "-avoid_negative_ts make_zero"
      ])
      .outputOptions([
        "-c:v libx264",
        `-b:v ${VIDEO_BITRATE}`,
        `-r ${VIDEO_FPS}`,        // force constant 30 fps
        "-vsync 1",
        "-pix_fmt yuv420p",
        "-c:a aac",
        `-b:a ${AUDIO_BITRATE}`,
        "-movflags +faststart",
      ])
      .on("start", (cmd) => {
        console.log("ffmpeg concat command:", cmd);
      })
      .save(output)
      .on("end", () => {
        console.log(`✅ Clean user video created → ${output}`);
        resolve(output);
      })
      .on("error", (err) => {
        console.error("concatUserChunks error:", err);
        reject(err);
      });
  });
};

/*
-------------------------------------------
 STEP 2: MERGE MULTIPLE USERS → FINAL MP4
-------------------------------------------
*/
export const mergeUsersIntoFinal = async (roomId, userVideos) => {
  const meetingDir = getMeetingDir(roomId);
  const output = path.join(meetingDir, "final-recording.mp4");

  // ONE USER → just re-normalize (ensure CFR + audio re-encode)
  if (userVideos.length === 1) {
    return new Promise((resolve, reject) => {
      ffmpeg(userVideos[0])
        .outputOptions([
          "-c:v libx264",
          `-b:v ${VIDEO_BITRATE}`,
          `-r ${VIDEO_FPS}`,
          "-vsync 1",
          "-pix_fmt yuv420p",
          "-c:a aac",
          `-b:a ${AUDIO_BITRATE}`,
          "-movflags +faststart",
        ])
        .save(output)
        .on("end", () => resolve(output))
        .on("error", (err) => {
          console.error("merge single user error:", err);
          reject(err);
        });
    });
  }

  // MULTI-USER MERGE
  // We'll normalize each input's timestamps, framerate and audio asynchronously, THEN stack and amix.
  // Build ffmpeg command with inputs and a filter_complex that:
  //  - for each video: setpts=PTS-STARTPTS,fps=VIDEO_FPS,setsar=1 -> label [v{i}]
  //  - for each audio: aresample=async=1 -> label [a{i}]
  //  - then hstack the [v{i}] inputs -> [vout]
  //  - amix the [a{i}] inputs -> [aout]

  const command = ffmpeg();
  userVideos.forEach(v => command.input(v));

  // per-input filter fragments
  const perVideoFilters = [];
  const perAudioLabels = [];
  const perVideoLabels = [];

  userVideos.forEach((_, i) => {
    // map input i video -> [vi] after normalization
    perVideoFilters.push(
      `[${i}:v]setpts=PTS-STARTPTS,fps=${VIDEO_FPS},setsar=1[v${i}]`
    );
    perVideoLabels.push(`[v${i}]`);

    // audio normalize/align
    perAudioLabels.push(`[a${i}]`);
    perVideoFilters.push(
      `[${i}:a]aresample=async=1,asetpts=PTS-STARTPTS[a${i}]`
    );
  });

  // stacking videos horizontally (hstack). If many users this will be wide; keep same approach as before.
  const videoStackFilter = `${perVideoLabels.join("")}hstack=inputs=${userVideos.length}[vout]`;

  // amix all audios
  const audioMixFilter = `${perAudioLabels.join("")}amix=inputs=${userVideos.length}:dropout_transition=2[aout]`;

  const filters = [
    ...perVideoFilters,
    videoStackFilter,
    audioMixFilter
  ];

  return new Promise((resolve, reject) => {
    command
      .complexFilter(filters)
      .outputOptions([
        "-map [vout]",
        "-map [aout]",
        "-c:v libx264",
        `-b:v ${VIDEO_BITRATE}`,
        `-r ${VIDEO_FPS}`,
        "-vsync 1",
        "-pix_fmt yuv420p",
        "-c:a aac",
        `-b:a ${AUDIO_BITRATE}`,
        "-movflags +faststart",
      ])
      .on("start", (cmd) => {
        console.log("ffmpeg merge command:", cmd);
      })
      .save(output)
      .on("end", () => {
        console.log("🎉 Final merged MP4 created!");
        resolve(output);
      })
      .on("error", (err) => {
        console.error("mergeUsersIntoFinal error:", err);
        reject(err);
      });
  });
};

/*
-------------------------------------------
 STEP 3: PROCESS FULL MEETING
-------------------------------------------
*/
export const processMeetingRecording = async (roomId) => {
  const meetingDir = getMeetingDir(roomId);
  const users = fs
    .readdirSync(meetingDir)
    .filter((i) => fs.statSync(path.join(meetingDir, i)).isDirectory());

  if (users.length === 0) throw new Error("No user recordings found");

  // 1) concat per-user
  const userVideos = [];
  for (const userId of users) {
    const out = await concatUserChunks(roomId, userId);
    userVideos.push(out);
  }

  // 2) merge all users
  const finalPath = await mergeUsersIntoFinal(roomId, userVideos);

  // 3) cleanup per-user folders and temp MP4s
  for (const userId of users) {
    try {
      fs.rmSync(path.join(meetingDir, userId), { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  }
  for (const v of userVideos) {
    try {
      if (fs.existsSync(v)) fs.unlinkSync(v);
    } catch (e) { /* ignore */ }
  }

  return {
    finalPath,
    sizeBytes: fs.statSync(finalPath).size,
    finalFileSizeMB: (fs.statSync(finalPath).size / 1024 / 1024).toFixed(2),
  };
};
