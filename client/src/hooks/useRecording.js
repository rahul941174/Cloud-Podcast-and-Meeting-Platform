import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../api';

/**
 * FIXED RECORDING HOOK - Consistent behavior
 * 
 * Key fixes:
 * - Proper state management
 * - Consistent chunk timing
 * - Better error handling
 * - Cleanup on unmount
 */

const useRecording = (localStream, roomId, userId) => {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingError, setRecordingError] = useState(null);
    
    const [stats, setStats] = useState({
        chunksRecorded: 0,
        chunksUploaded: 0,
        totalSize: 0,
        recordingDuration: 0
    });
    
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const uploadedCountRef = useRef(0);
    const recordingStartTimeRef = useRef(null);
    const durationIntervalRef = useRef(null);
    const chunkTimeoutRef = useRef(null);
    const shouldContinueRecordingRef = useRef(false);
    const isUploadingRef = useRef(false);

    // ==========================================
    // Convert Blob to Base64
    // ==========================================
    const blobToBase64 = (blob) => {
        return new Promise((resolve, reject) => {
            if (!blob || blob.size === 0) {
                return reject(new Error('Empty blob'));
            }
            
            const reader = new FileReader();
            
            reader.onload = () => {
                try {
                    const result = reader.result;
                    const commaIndex = result.indexOf(',');
                    const base64 = result.substring(commaIndex + 1);
                    
                    console.log(`   ✅ Base64: ${base64.length} chars from ${blob.size} bytes`);
                    resolve(base64);
                    
                } catch (error) {
                    console.error('❌ Base64 error:', error);
                    reject(error);
                }
            };
            
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };

    // ==========================================
    // Upload blob to server with retry logic
    // ==========================================
    const uploadBlob = useCallback(async (blob, chunkIndex, retries = 3) => {
        console.log(`\n📤 Uploading chunk ${chunkIndex}...`);
        console.log(`   Size: ${blob.size} bytes (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const chunkData = await blobToBase64(blob);
                
                const response = await api.post('/recordings/upload-chunk', {
                    roomId,
                    userId,
                    chunkIndex: chunkIndex,
                    chunkData
                }, {
                    timeout: 60000, // 60 second timeout
                });
                
                console.log(`✅ Chunk ${chunkIndex} uploaded successfully`);
                
                setStats(prev => ({
                    ...prev,
                    chunksUploaded: prev.chunksUploaded + 1
                }));
                
                return response.data;
                
            } catch (error) {
                console.error(`❌ Upload error chunk ${chunkIndex} (attempt ${attempt}/${retries}):`, error.message);
                
                if (attempt === retries) {
                    throw error;
                }
                
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }, [roomId, userId]);

    // ==========================================
    // Record a single chunk (10 seconds)
    // ==========================================
    const recordSingleChunk = useCallback(() => {
        return new Promise((resolve, reject) => {
            if (!localStream) {
                reject(new Error('No stream available'));
                return;
            }

            if (isUploadingRef.current) {
                console.log('⚠️ Upload in progress, waiting...');
                setTimeout(() => resolve(), 1000);
                return;
            }

            console.log(`\n🎬 Starting chunk ${uploadedCountRef.current}...`);
            
            // Reset chunk buffer
            recordedChunksRef.current = [];
            
            // Configure recorder
            let mimeType = 'video/webm;codecs=vp8,opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm';
                console.log('⚠️ Using fallback mimeType');
            }
            
            const recorder = new MediaRecorder(localStream, {
                mimeType,
                videoBitsPerSecond: 4000000,  // 4 Mbps
                audioBitsPerSecond: 192000    // 192 kbps
            });
            
            mediaRecorderRef.current = recorder;
            
            let chunkCount = 0;
            
            // Collect data chunks
            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    chunkCount++;
                    console.log(`   📹 Data chunk ${chunkCount}: ${event.data.size} bytes`);
                    recordedChunksRef.current.push(event.data);
                    
                    setStats(prev => ({
                        ...prev,
                        totalSize: prev.totalSize + event.data.size
                    }));
                }
            };
            
            // When stopped, upload
            recorder.onstop = async () => {
                console.log(`   ⏹️ Chunk ${uploadedCountRef.current} stopped (${chunkCount} data chunks)`);
                
                if (recordedChunksRef.current.length === 0) {
                    console.error('❌ No data chunks recorded!');
                    reject(new Error('No data recorded'));
                    return;
                }
                
                // Create complete blob
                const blob = new Blob(recordedChunksRef.current, { type: mimeType });
                console.log(`   📦 Blob size: ${blob.size} bytes`);
                
                if (blob.size < 1000) {
                    console.error('❌ Blob too small, skipping');
                    resolve();
                    return;
                }
                
                // Upload
                isUploadingRef.current = true;
                try {
                    await uploadBlob(blob, uploadedCountRef.current);
                    uploadedCountRef.current += 1;
                    
                    setStats(prev => ({
                        ...prev,
                        chunksRecorded: prev.chunksRecorded + 1
                    }));
                } catch (error) {
                    console.error('❌ Upload failed:', error);
                    setRecordingError(`Upload failed: ${error.message}`);
                } finally {
                    isUploadingRef.current = false;
                }
                
                resolve();
            };
            
            recorder.onerror = (error) => {
                console.error('❌ Recorder error:', error);
                reject(error);
            };
            
            // Start recording
            recorder.start();
            
            // Stop after exactly 10 seconds
            chunkTimeoutRef.current = setTimeout(() => {
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
            }, 10000); // Exactly 10 seconds
        });
    }, [localStream, uploadBlob]);

    // ==========================================
    // Recording loop
    // ==========================================
    const recordingLoop = useCallback(async () => {
        console.log('🔁 Recording loop started');
        
        while (shouldContinueRecordingRef.current) {
            try {
                await recordSingleChunk();
                
                // Small delay between chunks (100ms for restart)
                if (shouldContinueRecordingRef.current) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.error('❌ Recording loop error:', error);
                setRecordingError(error.message);
                
                // Continue recording despite error
                if (shouldContinueRecordingRef.current) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        console.log(`\n✅ Recording loop ended. Total chunks: ${uploadedCountRef.current}\n`);
    }, [recordSingleChunk]);

    // ==========================================
    // START RECORDING
    // ==========================================
    const startRecording = useCallback(async () => {
        if (!localStream) {
            console.error('❌ No stream');
            setRecordingError('No video stream available');
            return;
        }
        
        if (isRecording) {
            console.warn('⚠️ Already recording');
            return;
        }
        
        console.log('🎬 Starting continuous chunked recording...\n');
        
        // Reset everything
        recordedChunksRef.current = [];
        uploadedCountRef.current = 0;
        shouldContinueRecordingRef.current = true;
        isUploadingRef.current = false;
        
        setStats({
            chunksRecorded: 0,
            chunksUploaded: 0,
            totalSize: 0,
            recordingDuration: 0
        });
        setRecordingError(null);
        setIsRecording(true);
        
        // Duration counter
        recordingStartTimeRef.current = Date.now();
        durationIntervalRef.current = setInterval(() => {
            const duration = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000);
            setStats(prev => ({
                ...prev,
                recordingDuration: duration
            }));
        }, 1000);
        
        // Start the recording loop
        recordingLoop();
        
    }, [localStream, isRecording, recordingLoop]);

    // ==========================================
    // STOP RECORDING
    // ==========================================
    const stopRecording = useCallback(async () => {
        console.log('\n🛑 Stopping recording...');
        
        // Signal to stop the loop
        shouldContinueRecordingRef.current = false;
        
        // Clear timeout if exists
        if (chunkTimeoutRef.current) {
            clearTimeout(chunkTimeoutRef.current);
            chunkTimeoutRef.current = null;
        }
        
        // Stop current recorder if active
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
        
        // Wait for any ongoing upload
        let waitCount = 0;
        while (isUploadingRef.current && waitCount < 30) {
            console.log('⏳ Waiting for upload to complete...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            waitCount++;
        }
        
        // Clear intervals
        if (durationIntervalRef.current) {
            clearInterval(durationIntervalRef.current);
            durationIntervalRef.current = null;
        }
        
        setIsRecording(false);
        console.log('✅ Recording stopped');
        
    }, []);

    // ==========================================
    // DOWNLOAD BACKUP
    // ==========================================
    const downloadLocalRecording = useCallback(() => {
        alert('Local backup not available in chunked mode. Download from server instead.');
    }, []);

    // ==========================================
    // CLEANUP ON UNMOUNT
    // ==========================================
    useEffect(() => {
        return () => {
            console.log('🧹 Recording hook cleanup');
            shouldContinueRecordingRef.current = false;
            
            if (chunkTimeoutRef.current) {
                clearTimeout(chunkTimeoutRef.current);
            }
            
            if (mediaRecorderRef.current?.state === 'recording') {
                mediaRecorderRef.current.stop();
            }
            
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
            }
        };
    }, []);

    return {
        isRecording,
        recordingError,
        stats,
        startRecording,
        stopRecording,
        downloadLocalRecording,
        chunks: []
    };
};

export default useRecording;