// merge-worker/src/utils/fileHelper.js

import fs from "fs";
import path from "path";

// -----------------------------------------------------
// Base folder where server stores recordings
// merge-worker MUST read the SAME folder
// -----------------------------------------------------
export const RECORDINGS_DIR = path.join(
  process.cwd(),
  "..",
  "server",
  "recordings"
);

// Ensure base exists
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  console.log("📁 Created base recordings directory:", RECORDINGS_DIR);
}

// -----------------------------------------------------
// Get meeting directory
// Example: /recordings/<roomId>
// -----------------------------------------------------
export function getMeetingDir(roomId) {
  return path.join(RECORDINGS_DIR, roomId);
}

// -----------------------------------------------------
// Get user directory inside meeting folder
// Example: /recordings/<roomId>/<userId>
// -----------------------------------------------------
export function getUserDir(roomId, userId) {
  const dir = path.join(RECORDINGS_DIR, roomId, userId);
  return dir;
}

// -----------------------------------------------------
// Ensure meeting + user dirs exist (used by merge-worker)
// -----------------------------------------------------
export function ensureDirectories(roomId) {
  const meetingDir = getMeetingDir(roomId);

  if (!fs.existsSync(meetingDir)) {
    throw new Error(
      `❌ Meeting directory missing: ${meetingDir}\nServer may not have saved chunks yet.`
    );
  }

  const users = fs
    .readdirSync(meetingDir)
    .filter((item) => fs.statSync(path.join(meetingDir, item)).isDirectory());

  if (users.length === 0) {
    throw new Error(`❌ No user directories found inside ${meetingDir}`);
  }

  return users;
}

// -----------------------------------------------------
// List all .webm chunks for debugging
// -----------------------------------------------------
export function listChunks(roomId, userId) {
  const userDir = getUserDir(roomId, userId);

  if (!fs.existsSync(userDir)) {
    return [];
  }

  return fs
    .readdirSync(userDir)
    .filter((f) => f.endsWith(".webm"))
    .sort();
}
