// client/src/hooks/useRecording.js
import { useEffect, useRef, useState } from "react";
import api from "../api";

const MIN_CHUNK_SIZE = 5000; // at least 5KB
const CHUNK_DURATION_MS = 10000; // 10 sec chunks
const MIME = "video/webm;codecs=vp9,opus"; // best for merging

export default function useRecording(localStream, roomId, userId) {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingError, setRecordingError] = useState(null);
    const [stats, setStats] = useState(null);

    const recorderRef = useRef(null);
    const chunksRef = useRef([]);
    const chunkIndexRef = useRef(0);
    const loopActiveRef = useRef(false);

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    /* --------------------------
       START RECORDING
    --------------------------- */
    const startRecording = () => {
        if (!localStream) {
            setRecordingError("No local stream available");
            return;
        }

        if (isRecording) return;

        console.log("🎬 Starting recording...");

        setIsRecording(true);
        loopActiveRef.current = true;

        chunkIndexRef.current = 0;
        chunksRef.current = [];

        startRecorderLoop();
    };

    /* --------------------------
       STOP RECORDING
    --------------------------- */
    const stopRecording = () => {
        console.log("🛑 Stop recording requested");
        loopActiveRef.current = false;

        if (recorderRef.current) {
            try {
                recorderRef.current.stop();
            } catch {}
        }

        setIsRecording(false);
    };

    /* --------------------------
       MAIN RECORDING LOOP
       (restart recorder each chunk)
    --------------------------- */
    const startRecorderLoop = () => {
        if (!loopActiveRef.current) return;

        console.log("🎥 Creating new recorder for 10s chunk...");

        const recorder = new MediaRecorder(localStream, {
            mimeType: MIME,
            videoBitsPerSecond: 3_000_000, // smooth quality
            audioBitsPerSecond: 128_000,
        });

        recorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                console.log("📦 Chunk received:", e.data.size);
                chunksRef.current.push(e.data);
            }
        };

        recorder.onstop = async () => {
            const blob = new Blob(chunksRef.current, { type: MIME });

            if (blob.size > MIN_CHUNK_SIZE) {
                await uploadChunk(blob);
            }

            if (loopActiveRef.current) {
                console.log("🔁 Starting next 10s chunk...");
                startRecorderLoop();
            } else {
                console.log("🛑 Recording loop finished.");
            }
        };

        recorder.start();
        console.log("⏳ Chunk recording started…");

        // Stop after 10 seconds → triggers upload → then next chunk begins
        setTimeout(() => {
            if (recorder.state !== "inactive") recorder.stop();
        }, CHUNK_DURATION_MS);
    };

    /* --------------------------
       UPLOAD CHUNK
    --------------------------- */
    const uploadChunk = async (blob) => {
        try {
            const arrayBuffer = await blob.arrayBuffer();
            const base64Data = arrayBufferToBase64(arrayBuffer);

            const chunkIndex = chunkIndexRef.current++;
            const chunkId = `${Date.now()}-${chunkIndex}`;

            console.log(`📤 Uploading chunk ${chunkId} (${blob.size} bytes)`);

            await api.post(
                "/recordings/upload-chunk",
                {
                    roomId,
                    userId,
                    chunkId,
                    chunkData: base64Data,
                },
                { withCredentials: true }
            );

            console.log(`✅ Chunk ${chunkId} uploaded`);

            setStats((prev) => ({
                totalChunks: chunkIndex + 1,
                lastChunkSize: blob.size,
            }));
        } catch (err) {
            console.error("❌ Chunk upload error:", err);
        }
    };

    /* --------------------------
       CLEANUP
    --------------------------- */
    useEffect(() => {
        return () => {
            console.log("🧹 useRecording cleanup");

            loopActiveRef.current = false;

            if (recorderRef.current) {
                try {
                    recorderRef.current.stop();
                } catch {}
            }
        };
    }, []);

    return {
        isRecording,
        startRecording,
        stopRecording,
        recordingError,
        stats,
    };
}
