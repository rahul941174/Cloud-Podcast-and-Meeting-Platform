// server/src/controllers/mergeController.js
import fs from 'fs';
import path from 'path';
import { processMeetingRecording } from '../utils/ffmpegHelper.js';
import { getMeetingDir } from '../utils/fileHelper.js';

/**
 * Simple in-memory lock to prevent concurrent merge jobs for same room.
 * (Process restarts will clear this — acceptable for dev/most deploys.)
 */
const mergeLocks = new Set();

/**
 * POST /api/recordings/merge/:roomId
 * Trigger processing (concat + merge) for a meeting.
 * Returns merge result when done (blocking HTTP request).
 */
export const mergeMeetingRecording = async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) return res.status(400).json({ message: 'roomId required' });

    if (mergeLocks.has(roomId)) {
      return res.status(409).json({ message: 'Merge already in progress for this room' });
    }

    const meetingDir = getMeetingDir(roomId);
    if (!fs.existsSync(meetingDir)) {
      return res.status(404).json({ message: 'No recordings found for this room', roomId });
    }

    mergeLocks.add(roomId);
    console.log(`🎬 Merge started for room ${roomId}`);

    try {
      const result = await processMeetingRecording(roomId);
      console.log(`✅ Merge finished for room ${roomId}`);
      mergeLocks.delete(roomId);

      return res.status(200).json({
        message: 'Recording merged successfully',
        roomId,
        finalPath: result.finalPath,
        fileSizeBytes: result.sizeBytes,
        fileSizeMB: result.finalFileSizeMB,
      });
    } catch (err) {
      mergeLocks.delete(roomId);
      console.error(`❌ Merge failed for room ${roomId}:`, err.message || err);
      return res.status(500).json({
        message: 'Error merging recording',
        error: err.message || String(err),
      });
    }
  } catch (error) {
    console.error('❌ mergeMeetingRecording controller error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * GET /api/recordings/status/:roomId
 * Get status: whether chunks exist, how many users, whether final file exists.
 */
export const getRecordingStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) return res.status(400).json({ message: 'roomId required' });

    const meetingDir = getMeetingDir(roomId);
    if (!fs.existsSync(meetingDir)) {
      return res.status(404).json({ message: 'No recordings found for this room', roomId, hasRecording: false });
    }

    const items = fs.readdirSync(meetingDir);
    const userDirs = items.filter((i) => fs.statSync(path.join(meetingDir, i)).isDirectory());
    let totalChunks = 0;
    let totalSize = 0;

    for (const u of userDirs) {
      const userDir = path.join(meetingDir, u);
      const chunks = fs.readdirSync(userDir).filter((f) => f.endsWith('.webm'));
      totalChunks += chunks.length;
      for (const c of chunks) {
        totalSize += fs.statSync(path.join(userDir, c)).size;
      }
    }

    const finalVideoPath = path.join(meetingDir, 'final-recording.mp4');
    const hasFinalVideo = fs.existsSync(finalVideoPath);
    const mergeInProgress = mergeLocks.has(roomId);

    const finalInfo = hasFinalVideo ? {
      path: finalVideoPath,
      sizeBytes: fs.statSync(finalVideoPath).size,
      sizeMB: (fs.statSync(finalVideoPath).size / 1024 / 1024).toFixed(2),
    } : null;

    return res.status(200).json({
      message: 'Recording status',
      roomId,
      userCount: userDirs.length,
      totalChunks,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      hasFinalVideo,
      finalInfo,
      mergeInProgress,
    });

  } catch (error) {
    console.error('❌ getRecordingStatus error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * GET /api/recordings/download/:roomId
 * Stream the final merged video (final-recording.mp4) if exists.
 * After streaming we DON'T auto-delete here (let higher-level logic decide).
 */
export const downloadMeetingRecording = async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) return res.status(400).json({ message: 'roomId required' });

    const meetingDir = getMeetingDir(roomId);
    const finalVideoPath = path.join(meetingDir, 'final-recording.mp4');

    if (!fs.existsSync(finalVideoPath)) {
      return res.status(404).json({ message: 'Final recording not found. Has it been merged yet?' });
    }

    const stat = fs.statSync(finalVideoPath);
    const fileSize = stat.size;

    // Support range requests for resumable downloads / streaming players
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (start >= fileSize) {
        res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
        return;
      }

      const chunksize = end - start + 1;
      const file = fs.createReadStream(finalVideoPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="meeting-${roomId}.mp4"`,
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
        'Access-Control-Allow-Credentials': 'true',
      });

      file.pipe(res);
      return;
    }

    // Full file
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="meeting-${roomId}.mp4"`,
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
      'Access-Control-Allow-Credentials': 'true',
    });


    const stream = fs.createReadStream(finalVideoPath);
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error streaming file', error: err.message });
      } else {
        res.destroy();
      }
    });

  } catch (error) {
    console.error('❌ downloadMeetingRecording error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * DELETE /api/recordings/:roomId
 * Permanently delete meeting recordings (final + chunks)
 */
export const deleteRecording = async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) return res.status(400).json({ message: 'roomId required' });

    if (mergeLocks.has(roomId)) {
      return res.status(409).json({ message: 'Cannot delete while merge in progress' });
    }

    const meetingDir = getMeetingDir(roomId);
    if (!fs.existsSync(meetingDir)) {
      return res.status(404).json({ message: 'Recording not found', roomId });
    }

    // Compute freed size
    const getFolderSize = (dir) => {
      let size = 0;
      const items = fs.readdirSync(dir);
      for (const it of items) {
        const p = path.join(dir, it);
        const s = fs.statSync(p);
        if (s.isDirectory()) size += getFolderSize(p);
        else size += s.size;
      }
      return size;
    };

    const size = getFolderSize(meetingDir);
    fs.rmSync(meetingDir, { recursive: true, force: true });

    return res.status(200).json({ message: 'Recording deleted', roomId, freedMB: (size / 1024 / 1024).toFixed(2) });

  } catch (error) {
    console.error('❌ deleteRecording error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};
