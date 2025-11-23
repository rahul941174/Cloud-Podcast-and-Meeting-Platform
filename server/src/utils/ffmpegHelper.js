import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { getMeetingDir } from './fileHelper.js';

/**
 * SIMPLIFIED VALIDATION - Works with your WebM chunks
 * Just checks if file exists and has reasonable size
 */
const validateChunk = (chunkPath) => {
    return new Promise((resolve) => {
        // Check if file exists
        if (!fs.existsSync(chunkPath)) {
            console.error(`❌ Chunk not found: ${path.basename(chunkPath)}`);
            resolve(false);
            return;
        }

        // Check file size (must be at least 100KB)
        const stats = fs.statSync(chunkPath);
        if (stats.size < 100000) {
            console.error(`❌ Chunk too small: ${path.basename(chunkPath)} (${stats.size} bytes)`);
            resolve(false);
            return;
        }

        // Use ffprobe to validate (but don't reject if it fails)
        ffmpeg.ffprobe(chunkPath, (err, metadata) => {
            if (err) {
                console.warn(`⚠️ FFprobe warning for ${path.basename(chunkPath)}:`, err.message);
                console.warn(`   But file size is OK (${(stats.size / 1024 / 1024).toFixed(2)} MB), will try to use it`);
                resolve(true); // Accept it anyway if size is OK
                return;
            }

            // Check duration
            const duration = metadata.format.duration;
            if (duration && duration > 0) {
                console.log(`✅ Valid chunk: ${path.basename(chunkPath)}`);
                console.log(`   Duration: ${duration.toFixed(2)}s`);
                console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                resolve(true);
            } else {
                console.warn(`⚠️ No duration info for ${path.basename(chunkPath)}, but will try to use it`);
                resolve(true); // Accept anyway
            }
        });
    });
};

/**
 * Get sorted chunk files for a user
 */
const getChunkFiles = async (userDir) => {
    if (!fs.existsSync(userDir)) {
        throw new Error(`User directory not found: ${userDir}`);
    }

    const files = fs.readdirSync(userDir);
    const chunks = files
        .filter(file => file.endsWith('.webm'))
        .sort((a, b) => {
            const matchA = a.match(/chunk_(\d+)/);
            const matchB = b.match(/chunk_(\d+)/);
            const indexA = matchA ? parseInt(matchA[1], 10) : 0;
            const indexB = matchB ? parseInt(matchB[1], 10) : 0;
            return indexA - indexB;
        });

    console.log(`\n📁 Found ${chunks.length} chunks in ${path.basename(userDir)}`);

    if (chunks.length === 0) {
        throw new Error('No chunks found');
    }

    // Validate each chunk
    const validChunks = [];

    for (const chunk of chunks) {
        const chunkPath = path.join(userDir, chunk);
        const size = fs.statSync(chunkPath).size;

        console.log(`   Checking: ${chunk} (${(size / 1024).toFixed(2)} KB)`);

        // Simple size check
        if (size < 1000) {
            console.error(`   ⚠️ Too small, skipping`);
            continue;
        }

        const isValid = await validateChunk(chunkPath);

        if (isValid) {
            validChunks.push(chunk);
        } else {
            console.error(`   ⚠️ Invalid, skipping`);
        }
    }

    console.log(`\n✅ ${validChunks.length}/${chunks.length} chunks are valid\n`);

    if (validChunks.length === 0) {
        throw new Error('No valid chunks found');
    }

    return validChunks;
};

/**
 * Concatenate user chunks with re-encoding
 * This is your WORKING approach - keeping it the same!
 */
export const concatenateUserChunks = (userDir, outputPath) => {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(`🔗 Concatenating chunks: ${path.basename(userDir)}`);

            const chunkFilenames = await getChunkFiles(userDir);
            const concatListPath = path.join(userDir, 'concat-list.txt');

            // Build concat list with absolute paths
            const concatList = chunkFilenames
                .map(filename => {
                    const absPath = path.resolve(path.join(userDir, filename));
                    const normalizedPath = absPath.replace(/\\/g, '/');
                    return `file '${normalizedPath}'`;
                })
                .join('\n');

            fs.writeFileSync(concatListPath, concatList, 'utf8');

            console.log(`📝 Concat list created with ${chunkFilenames.length} entries\n`);

            // Re-encode with HIGH QUALITY settings (YOUR WORKING SETTINGS)
            ffmpeg()
                .input(concatListPath)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .outputOptions([
                    // 🔥 HIGH QUALITY VIDEO
                    '-c:v', 'libx264',
                    '-preset', 'slow',
                    '-crf', '18',
                    '-profile:v', 'high',
                    '-level', '4.0',
                    '-r', '30',
                    '-vsync', 'cfr',

                    // 🔥 HIGH QUALITY AUDIO
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-ar', '48000',
                    '-async', '1',

                    // Fast streaming
                    '-movflags', '+faststart'
                ])
                .output(outputPath)
                .on('start', cmdline => {
                    console.log('🎬 FFmpeg concat started');
                })
                .on('progress', progress => {
                    if (progress?.percent) {
                        console.log(`   Progress: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', () => {
                    console.log(`✅ Concatenation complete\n`);

                    // Cleanup concat list
                    try {
                        if (fs.existsSync(concatListPath)) {
                            fs.unlinkSync(concatListPath);
                        }
                    } catch (err) {
                        console.warn('Failed to remove concat list:', err.message);
                    }

                    resolve(outputPath);
                })
                .on('error', err => {
                    console.error('❌ FFmpeg error:', err.message);
                    reject(err);
                })
                .run();

        } catch (error) {
            console.error('❌ Concatenation setup error:', error);
            reject(error);
        }
    });
};

/**
 * Merge multiple user videos (YOUR WORKING APPROACH)
 */
export const mergeUserVideos = (userVideos, outputPath) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`🎬 Merging ${userVideos.length} user videos`);

            if (userVideos.length === 0) {
                return reject(new Error('No videos to merge'));
            }

            // Single participant
            if (userVideos.length === 1) {
                console.log('ℹ️ Single participant, converting to MP4\n');

                return ffmpeg(userVideos[0])
                    .outputOptions([
                        // 🔥 HIGH QUALITY
                        '-c:v', 'libx264',
                        '-preset', 'slow',
                        '-crf', '18',
                        '-profile:v', 'high',
                        '-level', '4.0',
                        '-r', '30',
                        '-vsync', 'cfr',
                        '-c:a', 'aac',
                        '-b:a', '192k',
                        '-ar', '48000',
                        '-movflags', '+faststart'
                    ])
                    .output(outputPath)
                    .on('start', () => console.log('🎬 Converting...'))
                    .on('progress', p => {
                        if (p?.percent) console.log(`   Progress: ${Math.round(p.percent)}%`);
                    })
                    .on('end', () => {
                        console.log('✅ Conversion complete\n');
                        resolve(outputPath);
                    })
                    .on('error', err => {
                        console.error('❌ Conversion error:', err.message);
                        reject(err);
                    })
                    .run();
            }

            // Multiple participants: side-by-side
            const command = ffmpeg();
            userVideos.forEach(video => command.input(video));

            const videoInputs = userVideos.map((_, i) => `[${i}:v]`).join('');
            const audioInputs = userVideos.map((_, i) => `[${i}:a]`).join('');

            const videoFilter = `${videoInputs}hstack=inputs=${userVideos.length}[v_out]`;
            const audioFilter = `${audioInputs}amix=inputs=${userVideos.length}:duration=longest[a_out]`;

            console.log('🔧 Side-by-side layout\n');

            command
                .complexFilter([videoFilter, audioFilter])
                .outputOptions([
                    '-map', '[v_out]',
                    '-map', '[a_out]',

                    // 🔥 HIGH QUALITY
                    '-c:v', 'libx264',
                    '-preset', 'slow',
                    '-crf', '18',
                    '-profile:v', 'high',
                    '-level', '4.0',
                    '-r', '30',
                    '-vsync', 'cfr',
                    '-c:a', 'aac',
                    '-b:a', '256k',
                    '-ar', '48000',
                    '-movflags', '+faststart'
                ])
                .output(outputPath)
                .on('start', () => console.log('🎬 Merging...'))
                .on('progress', p => {
                    if (p?.percent) console.log(`   Progress: ${Math.round(p.percent)}%`);
                })
                .on('end', () => {
                    console.log(`✅ Merge complete\n`);
                    resolve(outputPath);
                })
                .on('error', err => {
                    console.error('❌ Merge error:', err.message);
                    reject(err);
                })
                .run();

        } catch (error) {
            console.error('❌ Merge setup error:', error);
            reject(error);
        }
    });
};

/**
 * Process entire meeting recording (YOUR WORKING APPROACH)
 */
export const processMeetingRecording = async (roomId) => {
    try {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🎬 Processing recording: ${roomId}`);
        console.log(`${'='.repeat(60)}\n`);

        const meetingDir = getMeetingDir(roomId);

        if (!fs.existsSync(meetingDir)) {
            throw new Error(`Meeting directory not found: ${meetingDir}`);
        }

        const allItems = fs.readdirSync(meetingDir);
        const users = allItems.filter(item => {
            const itemPath = path.join(meetingDir, item);
            return fs.statSync(itemPath).isDirectory();
        });

        console.log(`👥 Found ${users.length} users\n`);

        if (users.length === 0) {
            throw new Error('No user recordings found');
        }

        // Step 1: Concatenate chunks per user
        console.log('📍 STEP 1: Concatenating user chunks\n');

        const userVideoPromises = users.map(async userId => {
            const userDir = path.join(meetingDir, userId);
            const userVideoPath = path.join(meetingDir, `user-${userId}.mp4`);

            await concatenateUserChunks(userDir, userVideoPath);
            return userVideoPath;
        });

        const userVideos = await Promise.all(userVideoPromises);
        console.log(`✅ All users concatenated\n`);

        // Step 2: Merge user videos
        console.log('📍 STEP 2: Merging all users\n');

        const finalVideoPath = path.join(meetingDir, 'final-recording.mp4');
        await mergeUserVideos(userVideos, finalVideoPath);

        // Step 3: Cleanup
        console.log('📍 STEP 3: Cleaning up\n');

        for (const userId of users) {
            const userDir = path.join(meetingDir, userId);
            try {
                fs.rmSync(userDir, { recursive: true, force: true });
                console.log(`🗑️ Deleted: ${userId}/`);
            } catch (err) {
                console.warn(`Failed to delete ${userId}:`, err.message);
            }
        }

        for (const userVideo of userVideos) {
            try {
                fs.unlinkSync(userVideo);
                console.log(`🗑️ Deleted: ${path.basename(userVideo)}`);
            } catch (err) {
                console.warn(`Failed to delete ${userVideo}:`, err.message);
            }
        }

        const stats = fs.statSync(finalVideoPath);
        const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);

        console.log(`\n${'='.repeat(60)}`);
        console.log(`✅ SUCCESS`);
        console.log(`${'='.repeat(60)}`);
        console.log(`📁 Final video: ${finalVideoPath}`);
        console.log(`📊 Size: ${fileSizeMB} MB`);
        console.log(`${'='.repeat(60)}\n`);

        return {
            success: true,
            videoPath: finalVideoPath,
            fileSize: stats.size,
            fileSizeMB
        };

    } catch (error) {
        console.error('\n❌ Processing failed:', error.message);
        throw error;
    }
};