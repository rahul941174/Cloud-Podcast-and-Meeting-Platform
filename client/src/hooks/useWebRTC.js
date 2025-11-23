import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../socket';

/**
 * Production-Grade useWebRTC Hook
 * Manages WebRTC peer connections with reliability features:
 * - Automatic retry on failure (3 attempts with exponential backoff)
 * - Proper cleanup to prevent memory leaks
 * - Connection state monitoring
 * - ICE candidate queuing
 * - Stale connection detection
 */

const useWebRTC = (roomId, userId, participants) => {
  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  // ==========================================
  // REFS (Don't trigger re-renders)
  // ==========================================
  const peerConnections = useRef({});
  const localStreamRef = useRef(null);
  const isCleaningUp = useRef(false);
  const retryAttempts = useRef({});
  const pendingCandidates = useRef({}); // Queue candidates until remote description set
  const connectionTimeouts = useRef({}); // Track connection timeouts

  // ICE servers configuration
  const iceServersRef = useRef({
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
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
    iceCandidatePoolSize: 10,
  });

  // ==========================================
  // CLEANUP FUNCTION
  // ==========================================
  const cleanupConnections = useCallback(() => {
    if (isCleaningUp.current) {
      console.log('⚠️ Cleanup already in progress');
      return;
    }

    console.log('🧹 Starting comprehensive cleanup...');
    isCleaningUp.current = true;

    // Clear all timeouts
    Object.values(connectionTimeouts.current).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    connectionTimeouts.current = {};

    // Stop all local tracks
    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getTracks();
      tracks.forEach((track) => {
        track.stop();
        console.log(`   Stopped ${track.kind} track`);
      });
      localStreamRef.current = null;
    }

    // Close all peer connections
    Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
      if (pc) {
        try {
          // Remove all event listeners
          pc.onicecandidate = null;
          pc.ontrack = null;
          pc.onconnectionstatechange = null;
          pc.onicegatheringstatechange = null;
          pc.onsignalingstatechange = null;
          pc.oniceconnectionstatechange = null;
          
          // Close connection
          if (pc.connectionState !== 'closed') {
            pc.close();
          }
          console.log(`   Closed connection: ${peerId}`);
        } catch (error) {
          console.error(`   Error closing connection ${peerId}:`, error);
        }
      }
    });

    // Clear all data structures
    peerConnections.current = {};
    retryAttempts.current = {};
    pendingCandidates.current = {};
    
    // Reset state
    setLocalStream(null);
    setRemoteStreams({});
    setConnectionStatus('disconnected');
    
    console.log('✅ Cleanup complete');
    isCleaningUp.current = false;
  }, []);

  // ==========================================
  // INITIALIZE LOCAL STREAM
  // ==========================================
  useEffect(() => {
    if (!roomId || !userId) return;

    let mounted = true;
    console.log('🎥 Initializing WebRTC for room:', roomId);

    const initLocalStream = async () => {
      // Check if we already have a stream
      if (localStreamRef.current) {
        console.log('✅ Using existing stream');
        setConnectionStatus('ready');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
            facingMode: 'user'
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000
          },
        });

        if (!mounted) {
          // Component unmounted, clean up
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        console.log('✅ Got local stream:', stream.id);
        console.log('   Video tracks:', stream.getVideoTracks().length);
        console.log('   Audio tracks:', stream.getAudioTracks().length);

        localStreamRef.current = stream;
        setLocalStream(stream);
        setConnectionStatus('ready');

      } catch (error) {
        console.error('❌ Error accessing camera/mic:', error);
        
        if (mounted) {
          setConnectionStatus('error');
          
          // Provide specific error messages
          let errorMessage = 'Cannot access camera/microphone. ';
          if (error.name === 'NotAllowedError') {
            errorMessage += 'Please grant permissions and refresh the page.';
          } else if (error.name === 'NotFoundError') {
            errorMessage += 'No camera or microphone found.';
          } else if (error.name === 'NotReadableError') {
            errorMessage += 'Camera/microphone is already in use by another application.';
          } else {
            errorMessage += 'Please check your device settings.';
          }
          
          alert(errorMessage);
        }
      }
    };

    initLocalStream();

    // Cleanup on unmount
    return () => {
      mounted = false;
      cleanupConnections();
    };
  }, [roomId, userId, cleanupConnections]);

  // ==========================================
  // CREATE PEER CONNECTION
  // ==========================================
  const createPeerConnection = useCallback(
    (peerId) => {
      if (isCleaningUp.current) {
        console.log('⚠️ Skipping peer creation during cleanup');
        return null;
      }

      // Close existing connection if any
      if (peerConnections.current[peerId]) {
        console.log(`🔄 Closing existing connection to ${peerId}`);
        try {
          peerConnections.current[peerId].close();
        } catch (error) {
          console.error('Error closing existing connection:', error);
        }
        delete peerConnections.current[peerId];
      }

      console.log(`🔗 Creating peer connection for: ${peerId}`);

      try {
        const pc = new RTCPeerConnection(iceServersRef.current);

        // Add local tracks
        if (localStream) {
          localStream.getTracks().forEach((track) => {
            try {
              pc.addTrack(track, localStream);
              console.log(`   Added ${track.kind} track to ${peerId}`);
            } catch (error) {
              console.error(`Error adding track:`, error);
            }
          });
        }

        // Handle incoming tracks
        pc.ontrack = (event) => {
          console.log(`📥 Received ${event.track.kind} track from ${peerId}`);
          if (!isCleaningUp.current && event.streams[0]) {
            setRemoteStreams((prev) => ({
              ...prev,
              [peerId]: event.streams[0],
            }));
          }
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate && !isCleaningUp.current) {
            console.log(`🧊 Sending ICE candidate to ${peerId}`);
            socket.emit('webrtc:ice-candidate', {
              candidate: event.candidate,
              targetUserId: peerId,
              roomId,
            });
          } else if (!event.candidate) {
            console.log(`✅ ICE gathering complete for ${peerId}`);
          }
        };

        // Monitor connection state
        pc.onconnectionstatechange = () => {
          const state = pc.connectionState;
          console.log(`🔌 Connection state with ${peerId}:`, state);

          if (isCleaningUp.current) return;

          switch (state) {
            case 'connected':
              console.log(`✅ Successfully connected to ${peerId}`);
              setConnectionStatus('connected');
              // Clear retry counter on success
              retryAttempts.current[peerId] = 0;
              // Clear connection timeout
              if (connectionTimeouts.current[peerId]) {
                clearTimeout(connectionTimeouts.current[peerId]);
                delete connectionTimeouts.current[peerId];
              }
              break;

            case 'failed':
              console.log(`⚠️ Connection failed with ${peerId}`);
              // Retry logic with exponential backoff
              const attempts = retryAttempts.current[peerId] || 0;
              if (attempts < 3) {
                retryAttempts.current[peerId] = attempts + 1;
                const delay = 2000 * Math.pow(2, attempts); // 2s, 4s, 8s
                console.log(`   Retry attempt ${attempts + 1}/3 in ${delay}ms`);
                
                setTimeout(() => {
                  if (!isCleaningUp.current) {
                    callPeer(peerId);
                  }
                }, delay);
              } else {
                console.error(`❌ Max retry attempts reached for ${peerId}`);
                setConnectionStatus('error');
              }
              break;

            case 'disconnected':
              console.log(`⚠️ Peer ${peerId} disconnected`);
              // Set timeout to retry if not reconnected
              connectionTimeouts.current[peerId] = setTimeout(() => {
                if (pc.connectionState === 'disconnected' && !isCleaningUp.current) {
                  console.log(`   Attempting to reconnect to ${peerId}`);
                  callPeer(peerId);
                }
              }, 5000);
              break;

            case 'closed':
              console.log(`❌ Connection closed with ${peerId}`);
              setRemoteStreams((prev) => {
                const updated = { ...prev };
                delete updated[peerId];
                return updated;
              });
              break;
          }
        };

        // Monitor ICE connection state
        pc.oniceconnectionstatechange = () => {
          console.log(`🧊 ICE connection state with ${peerId}:`, pc.iceConnectionState);
        };

        // Monitor ICE gathering state
        pc.onicegatheringstatechange = () => {
          console.log(`🧊 ICE gathering state with ${peerId}:`, pc.iceGatheringState);
        };

        // Monitor signaling state
        pc.onsignalingstatechange = () => {
          console.log(`📡 Signaling state with ${peerId}:`, pc.signalingState);
        };

        // Initialize pending candidates queue
        pendingCandidates.current[peerId] = [];

        // Store connection
        peerConnections.current[peerId] = pc;
        return pc;

      } catch (error) {
        console.error(`❌ Error creating peer connection for ${peerId}:`, error);
        return null;
      }
    },
    [localStream, roomId]
  );

  // ==========================================
  // CALL A PEER (Initiate connection)
  // ==========================================
  const callPeer = useCallback(
    async (peerId) => {
      if (isCleaningUp.current) return;

      console.log(`📞 Calling peer: ${peerId}`);
      setConnectionStatus('connecting');

      const pc = createPeerConnection(peerId);
      if (!pc) {
        console.error('Failed to create peer connection');
        return;
      }

      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });

        await pc.setLocalDescription(offer);
        console.log(`✅ Local description set for ${peerId}`);

        socket.emit('webrtc:offer', {
          offer,
          targetUserId: peerId,
          roomId,
        });

        console.log(`📤 Offer sent to ${peerId}`);

      } catch (error) {
        console.error(`❌ Error calling peer ${peerId}:`, error);
        setConnectionStatus('error');
      }
    },
    [createPeerConnection, roomId]
  );

  // ==========================================
  // SOCKET EVENT LISTENERS
  // ==========================================
  useEffect(() => {
    if (!localStream || isCleaningUp.current) return;

    // Handle incoming offer
    const handleOffer = async ({ offer, fromUserId }) => {
      if (isCleaningUp.current) return;

      console.log(`📥 Received offer from ${fromUserId}`);
      setConnectionStatus('connecting');

      const pc = createPeerConnection(fromUserId);
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`✅ Remote description set from ${fromUserId}`);

        // Process any pending ICE candidates
        if (pendingCandidates.current[fromUserId]?.length > 0) {
          console.log(`   Processing ${pendingCandidates.current[fromUserId].length} pending candidates`);
          for (const candidate of pendingCandidates.current[fromUserId]) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
              console.error('Error adding pending candidate:', error);
            }
          }
          pendingCandidates.current[fromUserId] = [];
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`✅ Local description set for ${fromUserId}`);

        socket.emit('webrtc:answer', {
          answer,
          targetUserId: fromUserId,
          roomId,
        });

        console.log(`📤 Answer sent to ${fromUserId}`);

      } catch (error) {
        console.error(`❌ Error handling offer from ${fromUserId}:`, error);
        setConnectionStatus('error');
      }
    };

    // Handle incoming answer
    const handleAnswer = async ({ answer, fromUserId }) => {
      if (isCleaningUp.current) return;

      console.log(`📥 Received answer from ${fromUserId}`);

      const pc = peerConnections.current[fromUserId];
      if (!pc) {
        console.error(`No peer connection found for ${fromUserId}`);
        return;
      }

      // Only set remote description if we're in the right state
      if (pc.signalingState !== 'have-local-offer') {
        console.warn(`Cannot set remote answer, signaling state is: ${pc.signalingState}`);
        return;
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`✅ Remote description set from ${fromUserId}`);

        // Process any pending ICE candidates
        if (pendingCandidates.current[fromUserId]?.length > 0) {
          console.log(`   Processing ${pendingCandidates.current[fromUserId].length} pending candidates`);
          for (const candidate of pendingCandidates.current[fromUserId]) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
              console.error('Error adding pending candidate:', error);
            }
          }
          pendingCandidates.current[fromUserId] = [];
        }

        // Reset retry counter on successful answer
        retryAttempts.current[fromUserId] = 0;

      } catch (error) {
        console.error(`❌ Error handling answer from ${fromUserId}:`, error);
      }
    };

    // Handle incoming ICE candidate
    const handleCandidate = async ({ candidate, fromUserId }) => {
      if (isCleaningUp.current) return;

      const pc = peerConnections.current[fromUserId];
      if (!pc) {
        console.warn(`No peer connection for ${fromUserId}, ignoring candidate`);
        return;
      }

      // Check if remote description is set
      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        // Queue the candidate for later
        console.log(`🧊 Queuing ICE candidate from ${fromUserId} (remote description not set)`);
        if (!pendingCandidates.current[fromUserId]) {
          pendingCandidates.current[fromUserId] = [];
        }
        pendingCandidates.current[fromUserId].push(candidate);
        return;
      }

      // Add candidate immediately
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`🧊 Added ICE candidate from ${fromUserId}`);
      } catch (error) {
        console.error(`❌ Error adding ICE candidate from ${fromUserId}:`, error);
      }
    };

    // Register socket listeners
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleCandidate);

    console.log('✅ Socket listeners registered');

    // Cleanup
    return () => {
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleCandidate);
      console.log('🧹 Socket listeners removed');
    };
  }, [localStream, roomId, createPeerConnection]);

  // ==========================================
  // HANDLE NEW PARTICIPANTS
  // ==========================================
  useEffect(() => {
    if (!localStream || !participants.length || isCleaningUp.current) return;

    // Small delay to ensure everything is ready
    const timer = setTimeout(() => {
      if (isCleaningUp.current) return;

      participants.forEach((participant) => {
        const participantId = participant.userId;
        
        // Don't call ourselves
        if (participantId === userId) return;

        // Don't create duplicate connections
        if (peerConnections.current[participantId]) {
          console.log(`⚠️ Connection already exists for ${participantId}`);
          return;
        }

        console.log(`👤 New participant detected: ${participant.username} (${participantId})`);
        callPeer(participantId);
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [participants, localStream, userId, callPeer]);

  // ==========================================
  // TOGGLE VIDEO
  // ==========================================
  const toggleVideo = useCallback(() => {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoEnabled(videoTrack.enabled);
      
      console.log(`📹 Video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
      
      socket.emit('webrtc:toggle-video', {
        roomId,
        enabled: videoTrack.enabled,
      });
    }
  }, [localStream, roomId]);

  // ==========================================
  // TOGGLE AUDIO
  // ==========================================
  const toggleAudio = useCallback(() => {
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsAudioEnabled(audioTrack.enabled);
      
      console.log(`🎤 Audio ${audioTrack.enabled ? 'enabled' : 'disabled'}`);
      
      socket.emit('webrtc:toggle-audio', {
        roomId,
        enabled: audioTrack.enabled,
      });
    }
  }, [localStream, roomId]);

  // ==========================================
  // RETURN VALUES
  // ==========================================
  return {
    localStream,
    remoteStreams,
    isVideoEnabled,
    isAudioEnabled,
    connectionStatus, // 'disconnected' | 'ready' | 'connecting' | 'connected' | 'error'
    toggleVideo,
    toggleAudio,
    cleanupConnections, // Exposed for manual cleanup if needed
  };
};

export default useWebRTC;