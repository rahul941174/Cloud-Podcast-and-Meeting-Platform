import { processMeetingRecording } from '../utils/ffmpegHelper.js';
import { getMeetingDir } from '../utils/fileHelper.js';
import fs from 'fs';  
import path from 'path'; 



/**
 * Trigger video merge for a meeting
 * 
 * This should be called after all users have stopped recording
 */
export const mergeMeetingRecording = async (req, res) => {
    try {
        const { roomId } = req.params;
        
        if (!roomId) {
            return res.status(400).json({
                message: 'roomId is required'
            });
        }
        
        console.log(`\n🎬 Merge request received for meeting: ${roomId}\n`);
        
        // Process recording (this may take a while)
        const result = await processMeetingRecording(roomId);
        
        // Return success with file info
        res.status(200).json({
            message: 'Recording merged successfully',
            ...result
        });
        
    } catch (error) {
        console.error('❌ Merge controller error:', error);
        res.status(500).json({
            message: 'Error merging recording',
            error: error.message
        });
    }
};

/**
 * Download the final merged video
 */
export const downloadMeetingRecording = async (req, res) => {
    try {
        const { roomId } = req.params;
        
        if (!roomId) {
            return res.status(400).json({
                message: 'roomId is required'
            });
        }
        
        const videoPath = path.join(getMeetingDir(roomId), 'final-recording.mp4');
        
        if (!fs.existsSync(videoPath)) {
            return res.status(404).json({
                message: 'Recording not found. Has it been merged yet?'
            });
        }
        
        // Stream video file to client
        res.download(videoPath, `meeting-${roomId}.mp4`, (err) => {
            if (err) {
                console.error('❌ Download error:', err);
            }
        });
        
    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).json({
            message: 'Error downloading recording',
            error: error.message
        });
    }
};