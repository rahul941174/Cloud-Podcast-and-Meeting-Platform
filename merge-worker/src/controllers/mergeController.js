// merge-worker/src/controllers/mergeController.js
import fs from "fs";
import path from "path";
import { getMeetingDir, getUserList } from "../utils/fileHelper.js";
import { processMeeting } from "../utils/ffmpegHelper.js";

/**
 * In-memory lock to prevent duplicate parallel merges.
 * If you don't do this, multiple merges will overlap and corrupt output.
 */
const mergeLocks = new Set();

/**
 * POST /api/merge/:roomId
 * This performs:
 * 1) validate meeting folder
 * 2) lock the room
 * 3) run FFmpeg pipeline
 * 4) respond with final file path
 */
export const mergeRecording = async (req, res) => {
  try {
    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({ message: "roomId is required" });
    }

    const meetingDir = getMeetingDir(roomId);

    if (!fs.existsSync(meetingDir)) {
      return res.status(404).json({
        message: "Recording directory not found",
        roomId,
      });
    }

    const users = getUserList(roomId);

    if (users.length === 0) {
      return res.status(400).json({
        message: "No user recordings found",
        roomId,
      });
    }

    // prevent double merges
    if (mergeLocks.has(roomId)) {
      return res.status(409).json({
        message: "Merge already in progress",
        roomId,
      });
    }

    mergeLocks.add(roomId);

    console.log(`🎬 Merge started for room ${roomId} with users:`, users);

    let finalPath;

    try {
      finalPath = await processMeeting(roomId);
    } catch (err) {
      mergeLocks.delete(roomId);
      console.error("❌ Merge failed:", err);
      return res.status(500).json({
        message: "Merge failed",
        error: err.message,
      });
    }

    mergeLocks.delete(roomId);

    console.log(`✅ Merge complete for room ${roomId}`);
    console.log(`📦 Output: ${finalPath}`);

    return res.status(200).json({
      message: "Merged successfully",
      roomId,
      output: finalPath,
    });

  } catch (error) {
    console.error("❌ mergeRecording controller error:", error);
    return res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
