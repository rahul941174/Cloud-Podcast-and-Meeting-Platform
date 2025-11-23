import express from 'express';
import { uploadChunk, getRecordingStatus } from '../controllers/recordingController.js';
import { mergeMeetingRecording, downloadMeetingRecording } from '../controllers/mergeController.js';
import auth from '../middlewares/auth.js';

const router = express.Router();


router.post('/upload-chunk', auth, uploadChunk);
router.get('/status/:roomId', auth, getRecordingStatus);


router.post('/merge/:roomId', auth, mergeMeetingRecording);
router.get('/download/:roomId', auth, downloadMeetingRecording);

export default router;