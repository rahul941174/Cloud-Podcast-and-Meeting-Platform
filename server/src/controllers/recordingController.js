import { saveChunk } from '../utils/fileHelper.js';
import fs from 'fs';

export const uploadChunk = async (req, res) => {
    try {

        console.log(`\n🔍 CONTROLLER RECEIVED:`);
        console.log(`   roomId: ${req.body.roomId}`);
        console.log(`   userId: ${req.body.userId}`);
        console.log(`   chunkIndex: ${req.body.chunkIndex}`);  // ← Check if this is correct!
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
        
        // Log what we're receiving
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
        
        // Verify buffer size
        if (buffer.length < 1000) {
            console.error(`❌ Suspiciously small buffer: ${buffer.length} bytes`);
            return res.status(400).json({
                message: 'Chunk data too small - possible corruption',
                receivedSize: buffer.length
            });
        }
        
        console.log(`✅ Valid chunk: ${buffer.length} bytes (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
        
        // 🔥 CRITICAL FIX: Pass chunkIndex to saveChunk
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
        console.log(`   Saved as: ${result.filename}\n`);  // 🔥 NEW: Log filename
        
        // Return success
        res.status(200).json({
            message: 'Chunk uploaded successfully',
            chunkIndex,
            size: savedSize,
            sizeMB: (savedSize / 1024 / 1024).toFixed(2),
            filename: result.filename,  // 🔥 NEW: Return filename
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

export const getRecordingStatus = async (req, res) => {
    try {
        const { roomId } = req.params;
        
        res.status(200).json({
            message: 'Recording status retrieved',
            roomId,
        });
        
    } catch (error) {
        console.error('❌ Error getting recording status:', error);
        res.status(500).json({
            message: 'Error getting recording status',
            error: error.message
        });
    }
};