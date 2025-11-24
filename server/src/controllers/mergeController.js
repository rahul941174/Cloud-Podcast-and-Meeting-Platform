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
        
        const meetingDir = getMeetingDir(roomId);
        
        if (!fs.existsSync(meetingDir)) {
            return res.status(404).json({
                message: 'Meeting recordings not found',
                roomId
            });
        }
        
        const videoPath = path.join(meetingDir, 'final-recording.mp4');
        
        if (!fs.existsSync(videoPath)) {
            return res.status(404).json({
                message: 'Recording not found. Has it been merged yet?',
                roomId
            });
        }
        
        const stats = fs.statSync(videoPath);
        console.log(`📥 Downloading recording: ${roomId}`);
        console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Set proper headers
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Content-Disposition', `attachment; filename="meeting-${roomId}.mp4"`);
        
        // Stream video file
        const stream = fs.createReadStream(videoPath);
        
        stream.on('error', (err) => {
            console.error('❌ Stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({
                    message: 'Error streaming video',
                    error: err.message
                });
            }
        });
        
        // 🔥 AUTO-DELETE AFTER DOWNLOAD COMPLETES
        stream.on('end', () => {
            console.log('✅ Download complete, cleaning up...');
            
            // Delete the entire meeting directory after 5 seconds
            setTimeout(() => {
                try {
                    if (fs.existsSync(meetingDir)) {
                        fs.rmSync(meetingDir, { recursive: true, force: true });
                        console.log(`🗑️ Auto-deleted meeting directory: ${roomId}`);
                        console.log(`   Freed up ~${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                    }
                } catch (cleanupError) {
                    console.error('Failed to auto-delete:', cleanupError);
                }
            }, 5000);
        });
        
        stream.pipe(res);
        
    } catch (error) {
        console.error('❌ Download error:', error);
        
        if (!res.headersSent) {
            res.status(500).json({
                message: 'Error downloading recording',
                error: error.message
            });
        }
    }
};


/**
 * Delete a meeting's recordings
 */
export const deleteRecording = async (req, res) => {
    try {
        const { roomId } = req.params;
        
        if (!roomId) {
            return res.status(400).json({
                message: 'roomId is required'
            });
        }
        
        const meetingDir = getMeetingDir(roomId);
        
        if (!fs.existsSync(meetingDir)) {
            return res.status(404).json({
                message: 'Recording not found',
                roomId
            });
        }
        
        // Get size before deleting
        const size = getFolderSize(meetingDir);
        
        // Delete the entire directory
        fs.rmSync(meetingDir, { recursive: true, force: true });
        
        console.log(`🗑️ Deleted recording: ${roomId}`);
        console.log(`   Freed: ${(size / 1024 / 1024).toFixed(2)} MB`);
        
        res.status(200).json({
            message: 'Recording deleted successfully',
            roomId,
            freedMB: (size / 1024 / 1024).toFixed(2)
        });
        
    } catch (error) {
        console.error('❌ Delete error:', error);
        res.status(500).json({
            message: 'Error deleting recording',
            error: error.message
        });
    }
};

/**
 * Delete ALL old recordings
 */
export const cleanupAllRecordings = async (req, res) => {
    try {
        const uploadsDir = path.join(getMeetingDir('..'), '..', 'uploads', 'recordings');
        
        if (!fs.existsSync(uploadsDir)) {
            return res.status(404).json({
                message: 'No recordings directory found'
            });
        }
        
        const meetings = fs.readdirSync(uploadsDir);
        let totalFreed = 0;
        let deletedCount = 0;
        
        for (const meetingId of meetings) {
            const meetingDir = path.join(uploadsDir, meetingId);
            
            if (fs.statSync(meetingDir).isDirectory()) {
                const size = getFolderSize(meetingDir);
                fs.rmSync(meetingDir, { recursive: true, force: true });
                
                totalFreed += size;
                deletedCount++;
                
                console.log(`🗑️ Deleted: ${meetingId} (${(size / 1024 / 1024).toFixed(2)} MB)`);
            }
        }
        
        console.log(`✅ Cleanup complete: ${deletedCount} recordings, ${(totalFreed / 1024 / 1024).toFixed(2)} MB freed`);
        
        res.status(200).json({
            message: 'All recordings deleted',
            deletedCount,
            freedMB: (totalFreed / 1024 / 1024).toFixed(2)
        });
        
    } catch (error) {
        console.error('❌ Cleanup error:', error);
        res.status(500).json({
            message: 'Error cleaning up recordings',
            error: error.message
        });
    }
};

/**
 * Get folder size recursively
 */
function getFolderSize(dirPath) {
    let size = 0;
    
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
            size += getFolderSize(filePath);
        } else {
            size += stats.size;
        }
    }
    
    return size;
}