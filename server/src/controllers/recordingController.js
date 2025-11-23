import { saveChunk } from '../utils/fileHelper.js';
import { getMeetingDir } from '../utils/fileHelper.js';
import fs from 'fs';
import path from 'path';

/**
 * Upload a recording chunk
 */
export const uploadChunk = async (req, res) => {
    try {
        console.log(`\n🔍 CONTROLLER RECEIVED:`);
        console.log(`   roomId: ${req.body.roomId}`);
        console.log(`   userId: ${req.body.userId}`);
        console.log(`   chunkIndex: ${req.body.chunkIndex}`);
        console.log(`   chunkData length: ${req.body.chunkData?.length}\n`);
        
        const { roomId, userId, chunkIndex, chunkData } = req.body;
        
        // Validate required fields
        if (!roomId || !userId || chunkIndex === undefined) {
            return res.status(400).json({
                message: 'Missing required fields: roomId, userId, or chunkIndex'
            });
        }
        
        if (!chunkData) {
            return res.status(400).json({
                message: 'No chunk data provided'
            });
        }
        
        console.log(`📥 Receiving chunk ${chunkIndex} from user ${userId}`);
        console.log(`   Base64 length: ${chunkData.length} chars`);
        
        // Convert base64 to buffer
        let buffer;
        try {
            buffer = Buffer.from(chunkData, 'base64');
        } catch (error) {
            console.error('❌ Invalid base64 data:', error);
            return res.status(400).json({
                message: 'Invalid chunk data format'
            });
        }
        
        // Verify buffer size (must be at least 1KB)
        if (buffer.length < 1000) {
            console.error(`❌ Suspiciously small buffer: ${buffer.length} bytes`);
            return res.status(400).json({
                message: 'Chunk data too small - possible corruption',
                receivedSize: buffer.length
            });
        }
        
        console.log(`✅ Valid chunk: ${buffer.length} bytes (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
        
        // Save chunk to disk
        const result = await saveChunk(roomId, userId, chunkIndex, buffer);
        
        // Verify file was saved correctly
        const savedSize = fs.statSync(result.filepath).size;
        
        if (savedSize !== buffer.length) {
            console.error(`⚠️ Size mismatch! Buffer: ${buffer.length}, Saved: ${savedSize}`);
            return res.status(500).json({
                message: 'File save verification failed - size mismatch',
                expected: buffer.length,
                actual: savedSize
            });
        }
        
        if (savedSize < 1000) {
            console.error(`⚠️ CORRUPT CHUNK DETECTED: ${savedSize} bytes`);
            
            try {
                fs.unlinkSync(result.filepath);
                console.log(`🗑️ Deleted corrupt chunk file`);
            } catch (e) {
                console.error('Failed to delete corrupt file:', e);
            }
            
            return res.status(400).json({
                message: 'Chunk appears corrupted (too small)',
                receivedSize: savedSize
            });
        }
        
        console.log(`✅ Chunk ${chunkIndex} saved and verified: ${savedSize} bytes (${(savedSize / 1024 / 1024).toFixed(2)} MB)`);
        console.log(`   Saved as: ${result.filename}\n`);
        
        // Return success
        res.status(200).json({
            message: 'Chunk uploaded successfully',
            chunkIndex,
            size: savedSize,
            sizeMB: (savedSize / 1024 / 1024).toFixed(2),
            filename: result.filename,
            ...result
        });
        
    } catch (error) {
        console.error('❌ Error uploading chunk:', error);
        res.status(500).json({
            message: 'Error uploading chunk',
            error: error.message
        });
    }
};

/**
 * Get recording status for a meeting
 * Returns info about chunks uploaded and final video status
 */
export const getRecordingStatus = async (req, res) => {
    try {
        const { roomId } = req.params;
        
        if (!roomId) {
            return res.status(400).json({
                message: 'roomId is required'
            });
        }
        
        const meetingDir = getMeetingDir(roomId);
        
        // Check if directory exists
        if (!fs.existsSync(meetingDir)) {
            return res.status(404).json({
                message: 'No recordings found for this meeting',
                roomId,
                hasRecording: false
            });
        }
        
        // Get all user directories
        const items = fs.readdirSync(meetingDir);
        const userDirs = items.filter(item => {
            const itemPath = path.join(meetingDir, item);
            return fs.statSync(itemPath).isDirectory();
        });
        
        // Count chunks per user
        const userChunks = {};
        let totalChunks = 0;
        let totalSize = 0;
        
        for (const userId of userDirs) {
            const userDir = path.join(meetingDir, userId);
            const chunks = fs.readdirSync(userDir).filter(f => f.endsWith('.webm'));
            
            userChunks[userId] = {
                count: chunks.length,
                chunks: chunks.sort()
            };
            
            totalChunks += chunks.length;
            
            // Calculate total size
            chunks.forEach(chunk => {
                const chunkPath = path.join(userDir, chunk);
                totalSize += fs.statSync(chunkPath).size;
            });
        }
        
        // Check if final video exists
        const finalVideoPath = path.join(meetingDir, 'final-recording.mp4');
        const hasFinalVideo = fs.existsSync(finalVideoPath);
        
        let finalVideoInfo = null;
        if (hasFinalVideo) {
            const stats = fs.statSync(finalVideoPath);
            finalVideoInfo = {
                size: stats.size,
                sizeMB: (stats.size / 1024 / 1024).toFixed(2),
                created: stats.birthtime
            };
        }
        
        res.status(200).json({
            message: 'Recording status retrieved',
            roomId,
            hasRecording: totalChunks > 0 || hasFinalVideo,
            userCount: userDirs.length,
            totalChunks,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
            userChunks,
            hasFinalVideo,
            finalVideo: finalVideoInfo
        });
        
    } catch (error) {
        console.error('❌ Error getting recording status:', error);
        res.status(500).json({
            message: 'Error getting recording status',
            error: error.message
        });
    }
};