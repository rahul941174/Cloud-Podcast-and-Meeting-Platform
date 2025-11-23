import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory (ES module fix)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create directory if it doesn't exist
 */
export const ensureDirectoryExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`✅ Created directory: ${dirPath}`);
    }
};

/**
 * Get the base uploads directory
 */
export const getUploadsDir = () => {
    // Go up from utils → src → server root → uploads
    return path.join(__dirname, '..', '..', 'uploads', 'recordings');
};

/**
 * Get directory for a specific meeting
 */
export const getMeetingDir = (roomId) => {
    const baseDir = getUploadsDir();
    const meetingDir = path.join(baseDir, roomId);
    ensureDirectoryExists(meetingDir);
    return meetingDir;
};

/**
 * Get directory for a specific user's recordings in a meeting
 */
export const getUserRecordingDir = (roomId, userId) => {
    const meetingDir = getMeetingDir(roomId);
    const userDir = path.join(meetingDir, userId);
    ensureDirectoryExists(userDir);
    return userDir;
};

/**
 * Save chunk to disk
 */
export const saveChunk = async (roomId, userId, chunkIndex, buffer) => {
    try {
        const userDir = getUserRecordingDir(roomId, userId);
        const filename = `chunk_${chunkIndex}.webm`;
        const filepath = path.join(userDir, filename);
        
        console.log(`\n💾 SAVING CHUNK:`);
        console.log(`   Room: ${roomId}`);
        console.log(`   User: ${userId}`);
        console.log(`   Index: ${chunkIndex}`);
        console.log(`   Filename: ${filename}`);
        console.log(`   Path: ${filepath}`);
        console.log(`   Size: ${buffer.length} bytes\n`);
        
        // Check if file already exists
        if (fs.existsSync(filepath)) {
            const existingSize = fs.statSync(filepath).size;
            console.log(`⚠️ WARNING: ${filename} already exists! (${existingSize} bytes)`);
            console.log(`   Will OVERWRITE with new ${buffer.length} bytes\n`);
        }
        
        // Write buffer to file
        await fs.promises.writeFile(filepath, buffer);
        
        // Verify it was saved
        const savedSize = fs.statSync(filepath).size;
        console.log(`✅ Saved chunk: ${filename} (${savedSize} bytes)`);
        
        return {
            success: true,
            filepath,
            filename,
            size: buffer.length
        };
    } catch (error) {
        console.error('❌ Error saving chunk:', error);
        throw error;
    }
};

/**
 * Clean up recordings for a meeting (after merging)
 */
export const cleanupMeetingRecordings = async (roomId) => {
    try {
        const meetingDir = getMeetingDir(roomId);
        
        if (fs.existsSync(meetingDir)) {
            await fs.promises.rm(meetingDir, { recursive: true, force: true });
            console.log(`✅ Cleaned up recordings for meeting: ${roomId}`);
        }
    } catch (error) {
        console.error('❌ Error cleaning up recordings:', error);
    }
};