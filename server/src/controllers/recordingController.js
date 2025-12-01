// server/src/controllers/recordingController.js
import fs from 'fs';
import path from 'path';
import { ensureMeetingUserDirs, getMeetingDir, saveChunkToDisk } from '../utils/fileHelper.js';

/**
 * POST /api/recordings/upload-chunk
 * Body:
 * {
 *   roomId: string,
 *   userId: string,
 *   chunkId: string,        // e.g. "169xxx_0" (unique per chunk)
 *   chunkData: string,      // base64 or dataURI
 * }
 */
export const uploadChunk = async (req, res) => {
  try {
    const { roomId, userId, chunkIndex, chunkId, chunkData } = req.body;

    // Basic validation
    if (!roomId || !userId) {
      return res.status(400).json({ message: "roomId and userId are required" });
    }

    if (!chunkIndex && chunkIndex !== 0 && !chunkId) {
      // FIX: server now accepts chunkIndex or chunkId
      return res.status(400).json({ message: "chunkIndex or chunkId is required" });
    }

    if (!chunkData || typeof chunkData !== "string") {
      return res.status(400).json({ message: "chunkData missing or invalid" });
    }

    // Ensure dirs exist
    const { meetingDir, userDir } = ensureMeetingUserDirs(roomId, userId);

    // FIX: Generate correct chunkId
    const timestamp = Date.now();
    const finalChunkId = chunkId
      ? chunkId
      : `${timestamp}-${chunkIndex}`; // FIX: deterministic "timestamp-index" format

    // FIX: filename safe
    const safeName = finalChunkId.replace(/[^a-zA-Z0-9-_\.]/g, "_");
    const filename = `${safeName}.webm`;
    const filepath = path.join(userDir, filename);

    // Support both dataURI + raw base64
    let base64 = chunkData;
    const comma = chunkData.indexOf(",");
    if (comma !== -1) base64 = chunkData.substring(comma + 1);

    // Decode base64 → buffer
    let buffer;
    try {
      buffer = Buffer.from(base64, "base64");
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ message: "Decoded chunk buffer is empty" });
      }
    } catch (err) {
      console.error("Base64 decode failed:", err);
      return res.status(400).json({ message: "Failed to decode base64 chunkData" });
    }

    // Save chunk through atomic write
    try {
      await saveChunkToDisk(filepath, buffer);
    } catch (err) {
      console.error("Failed to save chunk:", err);
      return res.status(500).json({ message: "Failed to save chunk", error: err.message });
    }

    const stat = fs.statSync(filepath);

    console.log(`📥 Saved chunk ${filename} (${stat.size} bytes) for user ${userId} in room ${roomId}`);

    return res.status(200).json({
      message: "Chunk uploaded",
      roomId,
      userId,
      chunkId: finalChunkId,
      filename,
      sizeBytes: stat.size,
    });

  } catch (error) {
    console.error("uploadChunk error:", error);
    return res.status(500).json({
      message: "Server error uploading chunk",
      error: error.message,
    });
  }
};

/**
 * GET /api/recordings/status/:roomId
 * Returns per-user chunk counts, sizes, and whether final video exists.
 */
export const getRecordingStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) return res.status(400).json({ message: 'roomId required' });

    const meetingDir = getMeetingDir(roomId);
    if (!fs.existsSync(meetingDir)) {
      return res.status(404).json({ message: 'No recordings found for this meeting', roomId });
    }

    const items = fs.readdirSync(meetingDir);
    const userDirs = items.filter((it) => fs.statSync(path.join(meetingDir, it)).isDirectory());

    const userChunks = {};
    let totalChunks = 0;
    let totalSize = 0;

    for (const userId of userDirs) {
      const userDir = path.join(meetingDir, userId);
      const chunks = fs
        .readdirSync(userDir)
        .filter((f) => f.endsWith('.webm'))
        .sort((a, b) => {
          // Prefer lexicographic (timestamp prefix) fallback to mtime
          const aNum = a.split('.')[0];
          const bNum = b.split('.')[0];
          if (aNum && bNum && /^\d+/.test(aNum) && /^\d+/.test(bNum)) {
            return aNum.localeCompare(bNum, undefined, { numeric: true });
          }
          // else fallback to mtime
          const am = fs.statSync(path.join(userDir, a)).mtimeMs;
          const bm = fs.statSync(path.join(userDir, b)).mtimeMs;
          return am - bm;
        });

      let userSize = 0;
      for (const c of chunks) {
        try {
          userSize += fs.statSync(path.join(userDir, c)).size;
        } catch (e) {
          // ignore unreadable file
        }
      }

      userChunks[userId] = {
        count: chunks.length,
        chunks,
        sizeBytes: userSize,
        sizeMB: (userSize / 1024 / 1024).toFixed(2),
      };

      totalChunks += chunks.length;
      totalSize += userSize;
    }

    const finalPath = path.join(meetingDir, 'final-recording.mp4');
    const hasFinal = fs.existsSync(finalPath);
    let finalInfo = null;
    if (hasFinal) {
      const s = fs.statSync(finalPath);
      finalInfo = { sizeBytes: s.size, sizeMB: (s.size / 1024 / 1024).toFixed(2), createdAt: s.birthtime };
    }

    return res.status(200).json({
      message: 'Recording status',
      roomId,
      userCount: userDirs.length,
      totalChunks,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      userChunks,
      hasFinalVideo: hasFinal,
      finalInfo,
    });
  } catch (error) {
    console.error('getRecordingStatus error:', error);
    return res.status(500).json({ message: 'Server error fetching status', error: error.message });
  }
};

/**
 * GET /api/recordings/:roomId/:userId/chunk/:chunkId
 * Stream a specific chunk (debugging)
 */
export const streamChunk = (req, res) => {
  try {
    const { roomId, userId, chunkId } = req.params;
    if (!roomId || !userId || !chunkId) {
      return res.status(400).json({ message: 'Missing params' });
    }

    const meetingDir = getMeetingDir(roomId);
    const chunkFile = `${chunkId}.webm`;
    const chunkPath = path.join(meetingDir, userId, chunkFile);

    if (!fs.existsSync(chunkPath)) return res.status(404).json({ message: 'Chunk not found' });

    res.setHeader('Content-Type', 'video/webm');
    const stream = fs.createReadStream(chunkPath);
    stream.pipe(res);
  } catch (error) {
    console.error('streamChunk error:', error);
    return res.status(500).json({ message: 'Error streaming chunk', error: error.message });
  }
};

export default {
  uploadChunk,
  getRecordingStatus,
  streamChunk,
};
