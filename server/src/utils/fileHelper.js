// server/src/utils/fileHelper.js
import fs from "fs";
import path from "path";

/**
 * Root recordings directory (shared with merge-worker)
 * -> server/recordings/
 */
export const RECORDINGS_DIR = path.join(process.cwd(), "recordings");

/**
 * Ensure directory exists (safe)
 */
export function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory → ${dir}`);
    }
  } catch (err) {
    console.error("❌ Failed to create directory:", dir, err);
    throw err;
  }
}

/**
 * Create & return meeting directory:
 * recordings/<roomId>/
 */
export function getMeetingDir(roomId) {
  const meetingDir = path.join(RECORDINGS_DIR, roomId);
  ensureDir(RECORDINGS_DIR);
  ensureDir(meetingDir);
  return meetingDir;
}

/**
 * Create & return user directory:
 * recordings/<roomId>/<userId>/
 */
export function getUserRecordingDir(roomId, userId) {
  const meetingDir = getMeetingDir(roomId);
  const userDir = path.join(meetingDir, userId.toString());
  ensureDir(userDir);
  return userDir;
}

/**
 * Ensures both meeting & user dirs exist
 */
export function ensureMeetingUserDirs(roomId, userId) {
  const meetingDir = getMeetingDir(roomId);
  const userDir = getUserRecordingDir(roomId, userId);
  return { meetingDir, userDir };
}

/**
 * Save chunk atomically:
 * 1. write file.tmp
 * 2. rename → final.webm
 *
 * prevents half-written files & corruption
 */
export async function saveChunkToDisk(filePath, buffer) {
  return new Promise((resolve, reject) => {
    const tmpPath = filePath + ".tmp";

    fs.writeFile(tmpPath, buffer, (err) => {
      if (err) return reject(err);

      fs.rename(tmpPath, filePath, (err2) => {
        if (err2) return reject(err2);

        resolve();
      });
    });
  });
}

/**
 * Helper: delete complete meeting dir
 */
export function deleteMeetingDir(roomId) {
  const meetingDir = getMeetingDir(roomId);

  if (fs.existsSync(meetingDir)) {
    fs.rmSync(meetingDir, { recursive: true, force: true });
    console.log(`🗑️ Deleted recordings for room ${roomId}`);
  }
}
