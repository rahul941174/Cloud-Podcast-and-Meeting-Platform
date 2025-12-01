// server/src/routes/recordingRoutes.js

import express from "express";
import {
  uploadChunk,
  getRecordingStatus,
} from "../controllers/recordingController.js";

import {
  mergeMeetingRecording,
  downloadMeetingRecording,
  deleteRecording,
} from "../controllers/mergeController.js";

const router = express.Router();

/**
 * ROUTES
 * ------
 * /upload-chunk       → upload WebM chunk
 * /status/:roomId     → get recording status
 * /merge/:roomId      → merge all chunks
 * /download/:roomId   → download merged MP4
 * /delete/:roomId     → delete meeting's recordings
 */

router.post("/upload-chunk", uploadChunk);

router.get("/status/:roomId", getRecordingStatus);

router.post("/merge/:roomId", mergeMeetingRecording);

router.get("/download/:roomId", downloadMeetingRecording);

router.delete("/delete/:roomId", deleteRecording);

export default router;
