// client/src/hooks/useWebRTC.js
import { useEffect, useRef, useState, useCallback } from "react";
import { socket } from "../socket";

/**
 * Simple WebRTC Hook
 * ------------------
 * Works with the simplified signalling server:
 *  - webrtc:offer
 *  - webrtc:answer
 *  - webrtc:ice-candidate
 */

const useWebRTC = (roomId, userId, participants) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);

  const peerConnections = useRef({}); // peerId -> RTCPeerConnection
  const localStreamRef = useRef(null);

  const ICE_SERVERS = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
  };

  // 1️⃣ GET LOCAL CAMERA + MIC
  useEffect(() => {
    if (!roomId || !userId) return;

    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        localStreamRef.current = stream;
        setLocalStream(stream);

        console.log("🎥 Local stream ready:", stream.id);
      } catch (err) {
        console.error("❌ Failed to get media:", err);
        alert("Camera/Microphone permission denied.");
      }
    };

    initMedia();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }

      for (const pc of Object.values(peerConnections.current)) {
        pc.close();
      }

      peerConnections.current = {};
      localStreamRef.current = null;
    };
  }, [roomId, userId]);

  // 2️⃣ CREATE PEER CONNECTION (only one per remote user)
  const createPeerConnection = useCallback(
    (peerId) => {
      if (peerConnections.current[peerId]) {
        return peerConnections.current[peerId];
      }

      console.log("🔗 Creating peer connection for:", peerId);

      const pc = new RTCPeerConnection(ICE_SERVERS);

      // Add local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) =>
          pc.addTrack(track, localStreamRef.current)
        );
      }

      // When we get a remote track
      pc.ontrack = (event) => {
        console.log("📥 Remote track from:", peerId);
        setRemoteStreams((prev) => ({
          ...prev,
          [peerId]: event.streams[0],
        }));
      };

      // ICE candidates -> Send to other peer
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("webrtc:ice-candidate", {
            candidate: event.candidate,
            targetUserId: peerId,
          });
        }
      };

      peerConnections.current[peerId] = pc;
      return pc;
    },
    [localStreamRef]
  );

  // 3️⃣ CALL A PEER → SEND OFFER
  const callPeer = useCallback(
    async (peerId) => {
      const pc = createPeerConnection(peerId);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit("webrtc:offer", {
          offer,
          targetUserId: peerId,
        });
      } catch (err) {
        console.error("❌ Error creating offer:", err);
      }
    },
    [createPeerConnection]
  );

  // 4️⃣ HANDLE SOCKET EVENTS (Offer, Answer, ICE)
  useEffect(() => {
    if (!localStream) return;

    const handleOffer = async ({ offer, fromUserId }) => {
      console.log("📥 Received offer from:", fromUserId);

      const pc = createPeerConnection(fromUserId);

      try {
        await pc.setRemoteDescription(offer);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("webrtc:answer", {
          answer,
          targetUserId: fromUserId,
        });
      } catch (err) {
        console.error("❌ Error handling offer:", err);
      }
    };

    const handleAnswer = async ({ answer, fromUserId }) => {
      console.log("📥 Received answer from:", fromUserId);

      const pc = peerConnections.current[fromUserId];
      if (!pc) return;

      try {
        await pc.setRemoteDescription(answer);
      } catch (err) {
        console.error("❌ Error setting remote answer:", err);
      }
    };

    const handleCandidate = async ({ candidate, fromUserId }) => {
      const pc = peerConnections.current[fromUserId];
      if (!pc) return;

      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error("❌ Error adding ICE candidate:", err);
      }
    };

    socket.on("webrtc:offer", handleOffer);
    socket.on("webrtc:answer", handleAnswer);
    socket.on("webrtc:ice-candidate", handleCandidate);

    return () => {
      socket.off("webrtc:offer", handleOffer);
      socket.off("webrtc:answer", handleAnswer);
      socket.off("webrtc:ice-candidate", handleCandidate);
    };
  }, [localStream, createPeerConnection]);

  // 5️⃣ HANDLE NEW PARTICIPANT JOIN EVENT → CALL THEM
  useEffect(() => {
    if (!localStream || !participants.length) return;

    participants.forEach((p) => {
      if (p.userId !== userId) {
        if (!peerConnections.current[p.userId]) {
          console.log("📞 Calling new participant:", p.userId);
          callPeer(p.userId);
        }
      }
    });
  }, [participants, localStream, userId, callPeer]);

  // 6️⃣ TOGGLE VIDEO
  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return;

    const track = localStreamRef.current.getVideoTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setIsVideoEnabled(track.enabled);
  }, []);

  // 7️⃣ TOGGLE AUDIO
  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return;

    const track = localStreamRef.current.getAudioTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setIsAudioEnabled(track.enabled);
  }, []);

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
