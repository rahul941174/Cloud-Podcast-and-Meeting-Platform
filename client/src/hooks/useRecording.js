import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../api';

/**
 * WORKING SOLUTION - Stop/Restart Every 10s
 * 
 * Strategy: Stop → Upload → Restart to force WebM headers
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
    const chunkIntervalRef = useRef(null);
    const shouldContinueRecordingRef = useRef(false);

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
    // Upload blob to server
    // ==========================================
    
    const uploadBlob = useCallback(async (blob, chunkIndex) => {
        console.log(`\n📤 Uploading chunk ${chunkIndex}...`);
        console.log(`   Size: ${blob.size} bytes (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
        
        try {
            const chunkData = await blobToBase64(blob);
            
            const response = await api.post('/recordings/upload-chunk', {
                roomId,
                userId,
                chunkIndex: chunkIndex,
                chunkData
            });
            
            console.log(`✅ Chunk ${chunkIndex} uploaded successfully`);
            
            setStats(prev => ({
                ...prev,
                chunksUploaded: prev.chunksUploaded + 1
            }));
            
            return response.data;
            
        } catch (error) {
            console.error(`❌ Upload error chunk ${chunkIndex}:`, error);
            throw error;
        }
    }, [roomId, userId]);

    // ==========================================
    // Start a single chunk recording (10 seconds)
    // ==========================================
    
    const recordSingleChunk = useCallback(() => {
        return new Promise((resolve) => {
            console.log(`\n🎬 Starting chunk ${uploadedCountRef.current}...`);
            
            // Reset chunk buffer
            recordedChunksRef.current = [];
            
            // Configure recorder
            let mimeType = 'video/webm;codecs=vp8,opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm';
            }
            
            const recorder = new MediaRecorder(localStream, {
                mimeType,
                videoBitsPerSecond: 4000000,  // 🔥 4 Mbps (was 2.5)
                audioBitsPerSecond: 192000    // 🔥 192 kbps (was 128)
            });
            
            mediaRecorderRef.current = recorder;
            
            // Collect data
            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    console.log(`   📹 Data: ${event.data.size} bytes`);
                    recordedChunksRef.current.push(event.data);
                    
                    setStats(prev => ({
                        ...prev,
                        totalSize: prev.totalSize + event.data.size
                    }));
                }
            };
            
            // When stopped, upload and resolve
            recorder.onstop = async () => {
                console.log(`   ⏹️ Chunk ${uploadedCountRef.current} stopped`);
                
                if (recordedChunksRef.current.length > 0) {
                    // Create complete blob
                    const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
                    console.log(`   📦 Blob size: ${blob.size} bytes`);
                    
                    // Upload
                    await uploadBlob(blob, uploadedCountRef.current);
                    uploadedCountRef.current += 1;
                    
                    setStats(prev => ({
                        ...prev,
                        chunksRecorded: prev.chunksRecorded + 1
                    }));
                }
                
                resolve();
            };
            
            recorder.onerror = (error) => {
                console.error('❌ Recorder error:', error);
                resolve();
            };
            
            // 🔥 Start WITHOUT timeslice - record continuously
            recorder.start();
            
            // 🔥 Stop after 10 seconds (slightly longer to compensate for restart delay)
            setTimeout(() => {
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
            }, 10100); // 10.1 seconds instead of 10
        });
    }, [localStream, uploadBlob, roomId, userId]);

    // ==========================================
    // Recording loop (keeps recording chunks)
    // ==========================================
    
    const recordingLoop = useCallback(async () => {
        while (shouldContinueRecordingRef.current) {
            await recordSingleChunk();
            
            // Small delay between chunks (reduced from 100ms to 50ms)
            if (shouldContinueRecordingRef.current) {
                await new Promise(resolve => setTimeout(resolve, 50));
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
            setRecordingError('No video stream');
            return;
        }
        
        if (isRecording) {
            console.warn('⚠️ Already recording');
            return;
        }
        
        console.log('🎬 Starting continuous chunked recording...\n');
        
        // Reset
        recordedChunksRef.current = [];
        uploadedCountRef.current = 0;
        shouldContinueRecordingRef.current = true;
        
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
    
    const stopRecording = useCallback(() => {
        console.log('\n🛑 Stopping recording...');
        
        // Signal to stop the loop
        shouldContinueRecordingRef.current = false;
        
        // Stop current recorder if active
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
        
        // Clear intervals
        if (durationIntervalRef.current) {
            clearInterval(durationIntervalRef.current);
            durationIntervalRef.current = null;
        }
        
        setIsRecording(false);
        
    }, []);

    // ==========================================
    // DOWNLOAD BACKUP
    // ==========================================
    
    const downloadLocalRecording = useCallback(() => {
        alert('Local backup not available in chunked mode. Download from server instead.');
    }, []);

    // ==========================================
    // CLEANUP
    // ==========================================
    
    useEffect(() => {
        return () => {
            shouldContinueRecordingRef.current = false;
            
            if (mediaRecorderRef.current?.state === 'recording') {
                mediaRecorderRef.current.stop();
            }
            
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
            }
            
            console.log('🧹 Cleanup');
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