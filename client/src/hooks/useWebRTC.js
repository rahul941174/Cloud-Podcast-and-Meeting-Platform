// ✅ FIXED — added useCallback for stable functions
import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../socket';

/**
 * useWebRTC Hook
 * Manages WebRTC peer connections for video calling
 */

const useWebRTC = (roomId, userId, participants) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);

  const peerConnections = useRef({});

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  };

  // ==========================================
  // 1️⃣ INITIALIZE - Get local camera/mic
  // ==========================================
  useEffect(() => {
    if (!roomId || !userId) return;

    console.log('🎥 Initializing WebRTC for room:', roomId);

    const initLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        console.log('✅ Got local stream:', stream.id);
        setLocalStream(stream);
      } catch (error) {
        console.error('❌ Error accessing camera/mic:', error);
        alert('Cannot access camera/microphone. Please grant permissions.');
      }
    };

    initLocalStream();

    // ✅ FIXED — copy ref to local variable to satisfy eslint
    const pcs = peerConnections.current;

    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      Object.values(pcs).forEach((pc) => pc.close());
    };
  }, [roomId, userId, localStream]); // ✅ FIXED — added localStream dependency

  // ==========================================
  // 2️⃣ CREATE PEER CONNECTION
  // ==========================================
  const createPeerConnection = useCallback(
    (peerId) => {
      console.log(`🔗 Creating peer connection for: ${peerId}`);

      const pc = new RTCPeerConnection(iceServers);

      if (localStream) {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      pc.ontrack = (event) => {
        console.log(`📥 Received track from ${peerId}:`, event.streams[0].id);
        setRemoteStreams((prev) => ({
          ...prev,
          [peerId]: event.streams[0],
        }));
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc:ice-candidate', {
            candidate: event.candidate,
            targetUserId: peerId,
            roomId,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`🔌 Connection state with ${peerId}:`, pc.connectionState);
      };

      peerConnections.current[peerId] = pc;
      return pc;
    },
    [localStream, roomId] // ✅ FIXED — stable function
  );

  // ==========================================
  // 3️⃣ CALL A PEER
  // ==========================================
  const callPeer = useCallback(
    async (peerId) => {
      console.log(`📞 Calling peer: ${peerId}`);
      const pc = createPeerConnection(peerId);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit('webrtc:offer', {
          offer,
          targetUserId: peerId,
          roomId,
        });
      } catch (error) {
        console.error(`❌ Error calling peer ${peerId}:`, error);
      }
    },
    [createPeerConnection, roomId] // ✅ FIXED — stable function dependency
  );

  // ==========================================
  // 4️⃣ SOCKET EVENT LISTENERS
  // ==========================================
  useEffect(() => {
    if (!localStream) return;

    const handleOffer = async ({ offer, fromUserId }) => {
      console.log(`📥 Received offer from ${fromUserId}`);
      const pc = createPeerConnection(fromUserId);

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', {
          answer,
          targetUserId: fromUserId,
          roomId,
        });
      } catch (error) {
        console.error(`❌ Error handling offer from ${fromUserId}:`, error);
      }
    };

    const handleAnswer = async ({ answer, fromUserId }) => {
      const pc = peerConnections.current[fromUserId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
          console.error(`❌ Error handling answer from ${fromUserId}:`, error);
        }
      }
    };

    const handleCandidate = async ({ candidate, fromUserId }) => {
      const pc = peerConnections.current[fromUserId];
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error(`❌ Error adding ICE candidate from ${fromUserId}:`, error);
        }
      }
    };

    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleCandidate);

    return () => {
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleCandidate);
    };
  }, [localStream, roomId, createPeerConnection]); // ✅ FIXED — added missing dep

  // ==========================================
  // 5️⃣ HANDLE NEW PARTICIPANTS
  // ==========================================
  useEffect(() => {
    if (!localStream || !participants.length) return;

    participants.forEach((participant) => {
      if (
        participant.userId !== userId &&
        !peerConnections.current[participant.userId]
      ) {
        callPeer(participant.userId);
      }
    });
  }, [participants, localStream, userId, callPeer]); // ✅ FIXED — added callPeer dependency

  // ==========================================
  // 6️⃣ TOGGLE VIDEO
  // ==========================================
  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        socket.emit('webrtc:toggle-video', {
          roomId,
          enabled: videoTrack.enabled,
        });
      }
    }
  }, [localStream, roomId]); // ✅ FIXED — stable function

  // ==========================================
  // 7️⃣ TOGGLE AUDIO
  // ==========================================
  const toggleAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        socket.emit('webrtc:toggle-audio', {
          roomId,
          enabled: audioTrack.enabled,
        });
      }
    }
  }, [localStream, roomId]); // ✅ FIXED — stable function

  return {
    localStream,
    remoteStreams,
    isVideoEnabled,
    isAudioEnabled,
    toggleVideo,
    toggleAudio,
  };
};

export default useWebRTC;
