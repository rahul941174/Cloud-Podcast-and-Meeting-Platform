import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../socket';



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
  // REFS
  // ==========================================
  const peerConnections = useRef({});
  const localStreamRef = useRef(null);
  const isCleaningUp = useRef(false);
  const retryAttempts = useRef({});
  const pendingCandidates = useRef({});
  const connectionTimeouts = useRef({});
  const retryTimers = useRef({}); // 🔥 FIX: Track retry timers
  const answerTimeouts = useRef({}); // 🔥 FIX: Track answer timeouts

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
  // 🔥 FIX: COMPLETE CLEANUP FUNCTION
  // ==========================================
  const cleanupConnections = useCallback(() => {
    if (isCleaningUp.current) {
      console.log('⚠️ Cleanup already in progress');
      return;
    }

    console.log('🧹 Starting comprehensive cleanup...');
    isCleaningUp.current = true;

    // 🔥 FIX: Clear ALL timeouts and timers
    Object.values(connectionTimeouts.current).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    connectionTimeouts.current = {};
    
    Object.values(retryTimers.current).forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    retryTimers.current = {};
    
    Object.values(answerTimeouts.current).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    answerTimeouts.current = {};

    // Stop all local tracks
    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getTracks();
      tracks.forEach((track) => {
        track.stop();
        console.log(`   Stopped ${track.kind} track`);
      });
      localStreamRef.current = null;
    }

    // 🔥 FIX: Close all peer connections completely
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

    // 🔥 FIX: Complete cleanup of all data structures
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
  // 🔥 FIX: CLEANUP SPECIFIC PEER
  // ==========================================
  const cleanupPeer = useCallback((peerId) => {
    console.log(`🧹 Cleaning up peer: ${peerId}`);
    
    // Clear timers
    if (connectionTimeouts.current[peerId]) {
      clearTimeout(connectionTimeouts.current[peerId]);
      delete connectionTimeouts.current[peerId];
    }
    
    if (retryTimers.current[peerId]) {
      clearTimeout(retryTimers.current[peerId]);
      delete retryTimers.current[peerId];
    }
    
    if (answerTimeouts.current[peerId]) {
      clearTimeout(answerTimeouts.current[peerId]);
      delete answerTimeouts.current[peerId];
    }
    
    // Close peer connection
    const pc = peerConnections.current[peerId];
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.onicegatheringstatechange = null;
        pc.onsignalingstatechange = null;
        pc.oniceconnectionstatechange = null;
        
        if (pc.connectionState !== 'closed') {
          pc.close();
        }
      } catch (error) {
        console.error(`Error closing peer ${peerId}:`, error);
      }
    }
    
    // 🔥 FIX: Delete peer connection entry
    delete peerConnections.current[peerId];
    
    // Clear pending candidates
    delete pendingCandidates.current[peerId];
    
    // Reset retry counter
    delete retryAttempts.current[peerId];
    
    // 🔥 FIX: Force remove remote stream from UI
    setRemoteStreams((prev) => {
      const updated = { ...prev };
      delete updated[peerId];
      return updated;
    });
  }, []);

  // ==========================================
  // INITIALIZE LOCAL STREAM
  // ==========================================
  useEffect(() => {
    if (!roomId || !userId) return;

    let mounted = true;
    console.log('🎥 Initializing WebRTC for room:', roomId);

    const initLocalStream = async () => {
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

    return () => {
      mounted = false;
      cleanupConnections();
    };
  }, [roomId, userId, cleanupConnections]);

  // ==========================================
  // 🔥 FIX: CREATE PEER CONNECTION WITH FULL CLEANUP
  // ==========================================
  const createPeerConnection = useCallback(
    (peerId) => {
      if (isCleaningUp.current) {
        console.log('⚠️ Skipping peer creation during cleanup');
        return null;
      }

      // 🔥 FIX: Complete cleanup of existing connection
      if (peerConnections.current[peerId]) {
        console.log(`🔄 Cleaning up existing connection to ${peerId}`);
        cleanupPeer(peerId);
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

        // 🔥 FIX: Buffered ICE candidate emission
        pc.onicecandidate = (event) => {
          if (event.candidate && !isCleaningUp.current) {
            // Only send if remote description is set
            if (pc.remoteDescription) {
              console.log(`🧊 Sending ICE candidate to ${peerId}`);
              socket.emit('webrtc:ice-candidate', {
                candidate: event.candidate,
                targetUserId: peerId,
                roomId,
              });
            } else {
              console.log(`🧊 Buffering ICE candidate for ${peerId} (no remote desc)`);
              if (!pendingCandidates.current[peerId]) {
                pendingCandidates.current[peerId] = [];
              }
              pendingCandidates.current[peerId].push(event.candidate);
            }
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
              retryAttempts.current[peerId] = 0;
              
              // Clear timeouts
              if (connectionTimeouts.current[peerId]) {
                clearTimeout(connectionTimeouts.current[peerId]);
                delete connectionTimeouts.current[peerId];
              }
              if (answerTimeouts.current[peerId]) {
                clearTimeout(answerTimeouts.current[peerId]);
                delete answerTimeouts.current[peerId];
              }
              break;

            case 'failed':
              console.log(`⚠️ Connection failed with ${peerId}`);
              const attempts = retryAttempts.current[peerId] || 0;
              
              if (attempts < 3) {
                retryAttempts.current[peerId] = attempts + 1;
                const delay = 2000 * Math.pow(2, attempts);
                console.log(`   Retry attempt ${attempts + 1}/3 in ${delay}ms`);
                
                retryTimers.current[peerId] = setTimeout(() => {
                  if (!isCleaningUp.current) {
                    cleanupPeer(peerId);
                    callPeer(peerId);
                  }
                }, delay);
              } else {
                console.error(`❌ Max retry attempts reached for ${peerId}`);
                cleanupPeer(peerId);
                setConnectionStatus('error');
              }
              break;

            case 'disconnected':
              console.log(`⚠️ Peer ${peerId} disconnected`);
              connectionTimeouts.current[peerId] = setTimeout(() => {
                if (pc.connectionState === 'disconnected' && !isCleaningUp.current) {
                  console.log(`   Attempting to reconnect to ${peerId}`);
                  cleanupPeer(peerId);
                  callPeer(peerId);
                }
              }, 5000);
              break;

            case 'closed':
              console.log(`❌ Connection closed with ${peerId}`);
              cleanupPeer(peerId);
              break;
          }
        };

        pc.oniceconnectionstatechange = () => {
          console.log(`🧊 ICE connection state with ${peerId}:`, pc.iceConnectionState);
          
          // 🔥 FIX: Handle ICE restart if needed
          if (pc.iceConnectionState === 'failed' && !isCleaningUp.current) {
            console.log(`🔄 ICE connection failed for ${peerId}, restarting...`);
            try {
              pc.restartIce();
            } catch (error) {
              console.error('ICE restart failed:', error);
            }
          }
        };

        pc.onicegatheringstatechange = () => {
          console.log(`🧊 ICE gathering state with ${peerId}:`, pc.iceGatheringState);
          
          // 🔥 FIX: Flush buffered candidates when gathering complete
          if (pc.iceGatheringState === 'complete' && pc.remoteDescription) {
            const buffered = pendingCandidates.current[peerId] || [];
            if (buffered.length > 0) {
              console.log(`🧊 Flushing ${buffered.length} buffered ICE candidates for ${peerId}`);
              buffered.forEach(candidate => {
                socket.emit('webrtc:ice-candidate', {
                  candidate,
                  targetUserId: peerId,
                  roomId,
                });
              });
              pendingCandidates.current[peerId] = [];
            }
          }
        };

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
    [localStream, roomId, cleanupPeer]
  );

  // ==========================================
  // 🔥 FIX: CALL PEER WITH TIMEOUT
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
        
        // 🔥 FIX: Set timeout for answer
        answerTimeouts.current[peerId] = setTimeout(() => {
          if (pc.signalingState === 'have-local-offer') {
            console.log(`⏱️ No answer received from ${peerId} in time`);
            cleanupPeer(peerId);
            
            // Retry once
            const attempts = retryAttempts.current[peerId] || 0;
            if (attempts < 1) {
              retryAttempts.current[peerId] = attempts + 1;
              console.log(`   Retrying call to ${peerId}...`);
              setTimeout(() => callPeer(peerId), 2000);
            }
          }
        }, 8000);

      } catch (error) {
        console.error(`❌ Error calling peer ${peerId}:`, error);
        setConnectionStatus('error');
        cleanupPeer(peerId);
      }
    },
    [createPeerConnection, roomId, cleanupPeer]
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

        // Process pending ICE candidates
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
        cleanupPeer(fromUserId);
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

      if (pc.signalingState !== 'have-local-offer') {
        console.warn(`Cannot set remote answer, signaling state is: ${pc.signalingState}`);
        return;
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`✅ Remote description set from ${fromUserId}`);
        
        // 🔥 FIX: Clear answer timeout
        if (answerTimeouts.current[fromUserId]) {
          clearTimeout(answerTimeouts.current[fromUserId]);
          delete answerTimeouts.current[fromUserId];
        }

        // Process pending ICE candidates
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

        retryAttempts.current[fromUserId] = 0;

      } catch (error) {
        console.error(`❌ Error handling answer from ${fromUserId}:`, error);
        cleanupPeer(fromUserId);
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

      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        console.log(`🧊 Queuing ICE candidate from ${fromUserId} (remote description not set)`);
        if (!pendingCandidates.current[fromUserId]) {
          pendingCandidates.current[fromUserId] = [];
        }
        pendingCandidates.current[fromUserId].push(candidate);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`🧊 Added ICE candidate from ${fromUserId}`);
      } catch (error) {
        console.error(`❌ Error adding ICE candidate from ${fromUserId}:`, error);
      }
    };
    
    // 🔥 FIX: Handle answer timeout
    const handleAnswerTimeout = ({ targetUserId }) => {
      console.log(`⏱️ Answer timeout for ${targetUserId}`);
      cleanupPeer(targetUserId);
    };
    
    // 🔥 FIX: Handle renegotiation request
    const handleRenegotiateRequest = async ({ fromUserId }) => {
      console.log(`🔄 Renegotiation requested by ${fromUserId}`);
      
      const pc = peerConnections.current[fromUserId];
      if (pc && pc.connectionState === 'connected') {
        cleanupPeer(fromUserId);
        setTimeout(() => callPeer(fromUserId), 500);
      }
    };

    // Register socket listeners
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleCandidate);
    socket.on('webrtc:answer-timeout', handleAnswerTimeout);
    socket.on('webrtc:renegotiate-request', handleRenegotiateRequest);

    console.log('✅ Socket listeners registered');

    return () => {
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleCandidate);
      socket.off('webrtc:answer-timeout', handleAnswerTimeout);
      socket.off('webrtc:renegotiate-request', handleRenegotiateRequest);
      console.log('🧹 Socket listeners removed');
    };
  }, [localStream, roomId, createPeerConnection, callPeer, cleanupPeer]);

  // ==========================================
  // 🔥 FIX: HANDLE USER DISCONNECTION
  // ==========================================
  useEffect(() => {
    const handleUserDisconnected = ({ userId: disconnectedUserId, cleanupRequired }) => {
      console.log(`👋 User ${disconnectedUserId} disconnected`);
      
      if (cleanupRequired) {
        cleanupPeer(disconnectedUserId);
      }
    };

    socket.on('user-disconnected', handleUserDisconnected);

    return () => {
      socket.off('user-disconnected', handleUserDisconnected);
    };
  }, [cleanupPeer]);

  // ==========================================
  // 🔥 FIX: HANDLE NEW PARTICIPANTS (IMPROVED)
  // ==========================================
  useEffect(() => {
    if (!localStream || !participants.length || isCleaningUp.current) return;

    const timer = setTimeout(() => {
      if (isCleaningUp.current) return;

      participants.forEach((participant) => {
        const participantId = participant.userId;
        
        if (participantId === userId) return;

        // 🔥 FIX: Check if connection exists and is connected
        const existingPC = peerConnections.current[participantId];
        if (existingPC && existingPC.connectionState === 'connected') {
          console.log(`⚠️ Already connected to ${participantId}`);
          return;
        }

        // 🔥 FIX: If connection exists but not connected, clean up first
        if (existingPC) {
          console.log(`🔄 Cleaning stale connection to ${participantId}`);
          cleanupPeer(participantId);
        }

        console.log(`👤 New participant detected: ${participant.username} (${participantId})`);
        callPeer(participantId);
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [participants, localStream, userId, callPeer, cleanupPeer]);

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
      
      // 🔥 FIX: Request renegotiation for all peers
      Object.keys(peerConnections.current).forEach(peerId => {
        socket.emit('webrtc:renegotiate', {
          targetUserId: peerId,
          roomId
        });
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
    connectionStatus,
    toggleVideo,
    toggleAudio,
    cleanupConnections,
  };
};

export default useWebRTC;