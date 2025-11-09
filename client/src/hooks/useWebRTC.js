import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket';

/**
 * useWebRTC Hook
 * 
 * Manages WebRTC peer connections for video calling
 * 
 * How it works:
 * 1. Gets local camera/mic stream
 * 2. Creates peer connections for each participant
 * 3. Exchanges connection info via socket (signaling)
 * 4. Manages remote video streams
 */

const useWebRTC = (roomId, userId, participants) => {
    // Store local video stream (your camera)
    const [localStream, setLocalStream] = useState(null);
    
    // Store remote video streams (other participants)
    const [remoteStreams, setRemoteStreams] = useState({});
    
    // Track audio/video state
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    
    // Store peer connections (one per participant)
    const peerConnections = useRef({});
    
    // STUN/TURN servers for reliable connections
    // STUN: Helps find public IP address
    // TURN: Relays traffic when direct connection fails
    const iceServers = {
        iceServers: [
            // Free STUN servers
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            // Free TURN servers (limited, for testing)
            // For production, get your own from Twilio/Metered.ca
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    };

    // ==========================================
    // 1️⃣ INITIALIZE - Get local camera/mic
    // ==========================================
    useEffect(() => {
        if (!roomId || !userId) return;

        console.log("🎥 Initializing WebRTC for room:", roomId);

        const initLocalStream = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
                
                console.log("✅ Got local stream:", stream.id);
                setLocalStream(stream);
                
            } catch (error) {
                console.error("❌ Error accessing camera/mic:", error);
                alert("Cannot access camera/microphone. Please grant permissions.");
            }
        };

        initLocalStream();

        // Cleanup on unmount
        return () => {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
            // Close all peer connections
            Object.values(peerConnections.current).forEach(pc => pc.close());
        };
    }, [roomId, userId]);

    // ==========================================
    // 2️⃣ CREATE PEER CONNECTION
    // ==========================================
    const createPeerConnection = (peerId) => {
        console.log(`🔗 Creating peer connection for: ${peerId}`);

        const pc = new RTCPeerConnection(iceServers);

        // Add local stream tracks to peer connection
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        // Handle incoming remote stream
        pc.ontrack = (event) => {
            console.log(`📥 Received track from ${peerId}:`, event.streams[0].id);
            setRemoteStreams(prev => ({
                ...prev,
                [peerId]: event.streams[0]
            }));
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`🧊 Sending ICE candidate to ${peerId}`);
                socket.emit("webrtc:ice-candidate", {
                    candidate: event.candidate,
                    targetUserId: peerId,
                    roomId
                });
            }
        };

        // Monitor connection state
        pc.onconnectionstatechange = () => {
            console.log(`🔌 Connection state with ${peerId}:`, pc.connectionState);
            
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                console.log(`❌ Connection failed with ${peerId}`);
            }
        };

        peerConnections.current[peerId] = pc;
        return pc;
    };

    // ==========================================
    // 3️⃣ CALL A PEER (Create offer)
    // ==========================================
    const callPeer = async (peerId) => {
        console.log(`📞 Calling peer: ${peerId}`);

        const pc = createPeerConnection(peerId);

        try {
            // Create offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            console.log(`📤 Sending offer to ${peerId}`);
            socket.emit("webrtc:offer", {
                offer,
                targetUserId: peerId,
                roomId
            });
        } catch (error) {
            console.error(`❌ Error calling peer ${peerId}:`, error);
        }
    };

    // ==========================================
    // 4️⃣ SOCKET EVENT LISTENERS
    // ==========================================
    useEffect(() => {
        if (!localStream) return;

        // Handle incoming offer
        socket.on("webrtc:offer", async ({ offer, fromUserId }) => {
            console.log(`📥 Received offer from ${fromUserId}`);

            const pc = createPeerConnection(fromUserId);

            try {
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                
                // Create answer
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                console.log(`📤 Sending answer to ${fromUserId}`);
                socket.emit("webrtc:answer", {
                    answer,
                    targetUserId: fromUserId,
                    roomId
                });
            } catch (error) {
                console.error(`❌ Error handling offer from ${fromUserId}:`, error);
            }
        });

        // Handle incoming answer
        socket.on("webrtc:answer", async ({ answer, fromUserId }) => {
            console.log(`📥 Received answer from ${fromUserId}`);

            const pc = peerConnections.current[fromUserId];
            if (pc) {
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(answer));
                } catch (error) {
                    console.error(`❌ Error handling answer from ${fromUserId}:`, error);
                }
            }
        });

        // Handle incoming ICE candidate
        socket.on("webrtc:ice-candidate", async ({ candidate, fromUserId }) => {
            console.log(`🧊 Received ICE candidate from ${fromUserId}`);

            const pc = peerConnections.current[fromUserId];
            if (pc) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (error) {
                    console.error(`❌ Error adding ICE candidate from ${fromUserId}:`, error);
                }
            }
        });

        // Handle peer video toggle
        socket.on("webrtc:peer-video-toggle", ({ userId: peerId, enabled }) => {
            console.log(`📹 Peer ${peerId} ${enabled ? 'enabled' : 'disabled'} video`);
            // You can update UI to show video is off
        });

        // Handle peer audio toggle
        socket.on("webrtc:peer-audio-toggle", ({ userId: peerId, enabled }) => {
            console.log(`🎤 Peer ${peerId} ${enabled ? 'unmuted' : 'muted'} audio`);
            // You can update UI to show mic is muted
        });

        return () => {
            socket.off("webrtc:offer");
            socket.off("webrtc:answer");
            socket.off("webrtc:ice-candidate");
            socket.off("webrtc:peer-video-toggle");
            socket.off("webrtc:peer-audio-toggle");
        };
    }, [localStream, roomId]);

    // ==========================================
    // 5️⃣ HANDLE NEW PARTICIPANTS
    // ==========================================
    useEffect(() => {
        if (!localStream || !participants.length) return;

        // Call all participants except yourself
        participants.forEach(participant => {
            if (participant.userId !== userId && !peerConnections.current[participant.userId]) {
                console.log(`👤 New participant detected: ${participant.username}`);
                callPeer(participant.userId);
            }
        });
    }, [participants, localStream, userId]);

    // ==========================================
    // 6️⃣ TOGGLE VIDEO
    // ==========================================
    const toggleVideo = () => {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setIsVideoEnabled(videoTrack.enabled);
                
                // Notify others
                socket.emit("webrtc:toggle-video", {
                    roomId,
                    enabled: videoTrack.enabled
                });
                
                console.log(`📹 Video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
            }
        }
    };

    // ==========================================
    // 7️⃣ TOGGLE AUDIO
    // ==========================================
    const toggleAudio = () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsAudioEnabled(audioTrack.enabled);
                
                // Notify others
                socket.emit("webrtc:toggle-audio", {
                    roomId,
                    enabled: audioTrack.enabled
                });
                
                console.log(`🎤 Audio ${audioTrack.enabled ? 'enabled' : 'disabled'}`);
            }
        }
    };

    return {
        localStream,
        remoteStreams,
        isVideoEnabled,
        isAudioEnabled,
        toggleVideo,
        toggleAudio
    };
};

export default useWebRTC;