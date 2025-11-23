import express from 'express';
import { uploadChunk, getRecordingStatus } from '../controllers/recordingController.js';
import { mergeMeetingRecording, downloadMeetingRecording } from '../controllers/mergeController.js';  // ← ADD
import auth from '../middlewares/auth.js';

const router = express.Router();

// Existing routes
router.post('/upload-chunk', auth, uploadChunk);
router.get('/status/:roomId', auth, getRecordingStatus);

// NEW: Merge routes
router.post('/merge/:roomId', auth, mergeMeetingRecording);         // ← ADD
router.get('/download/:roomId', auth, downloadMeetingRecording);    // ← ADD

export default router;