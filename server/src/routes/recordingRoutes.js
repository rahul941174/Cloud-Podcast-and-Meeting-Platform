import express from 'express';
import { uploadChunk, getRecordingStatus } from '../controllers/recordingController.js';
import { 
    mergeMeetingRecording, 
    downloadMeetingRecording,
    deleteRecording,           
    cleanupAllRecordings       
} from '../controllers/mergeController.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// Recording routes
router.post('/upload-chunk', auth, uploadChunk);
router.get('/status/:roomId', auth, getRecordingStatus);

// Merge routes
router.post('/merge/:roomId', auth, mergeMeetingRecording);
router.get('/download/:roomId', auth, downloadMeetingRecording);

//   Cleanup routes
router.delete('/delete/:roomId', auth, deleteRecording);           // Delete one
router.post('/cleanup-all', auth, cleanupAllRecordings);           // Delete all

export default router;