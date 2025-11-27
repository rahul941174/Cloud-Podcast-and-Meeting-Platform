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
  const makingOffer = useRef({});
  const activeParticipants = useRef(new Set()); // 🔥 Track active participants

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
  // POLITE PEER (for glare resolution)
  // ==========================================
  const isPolite = useCallback((peerId) => {
    return userId < peerId;
  }, [userId]);

  // ==========================================
  // 🔥 NEW: CLEANUP SINGLE PEER
  // ==========================================
  const cleanupPeer = useCallback((peerId, reason = 'cleanup') => {
    console.log(`🧹 Cleaning up peer ${peerId} (reason: ${reason})`);
    
    // Clear timeout
    if (connectionTimeouts.current[peerId]) {
      clearTimeout(connectionTimeouts.current[peerId]);
      delete connectionTimeouts.current[peerId];
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
        console.log(`   ✅ Closed peer connection for ${peerId}`);
      } catch (error) {
        console.error(`   ❌ Error closing connection ${peerId}:`, error);
      }
      delete peerConnections.current[peerId];
    }

    // Clear all related state
    delete retryAttempts.current[peerId];
    delete pendingCandidates.current[peerId];
    delete makingOffer.current[peerId];
    
    // 🔥 CRITICAL: Remove from remoteStreams immediately
    setRemoteStreams((prev) => {
      const updated = { ...prev };
      if (updated[peerId]) {
        console.log(`   ✅ Removed stream for ${peerId}`);
        delete updated[peerId];
      }
      return updated;
    });

    console.log(`✅ Peer ${peerId} cleanup complete`);
  }, []);

  // ==========================================
  // CLEANUP ALL CONNECTIONS
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

    // Close all peer connections using cleanupPeer
    Object.keys(peerConnections.current).forEach(peerId => {
      cleanupPeer(peerId, 'full-cleanup');
    });

    // Clear all data structures
    peerConnections.current = {};
    retryAttempts.current = {};
    pendingCandidates.current = {};
    makingOffer.current = {};
    activeParticipants.current = new Set();
    
    // Reset state
    setLocalStream(null);
    setRemoteStreams({});
    setConnectionStatus('disconnected');
    
    console.log('✅ Cleanup complete');
    isCleaningUp.current = false;
  }, [cleanupPeer]);

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
  // CREATE PEER CONNECTION
  // ==========================================
  const createPeerConnection = useCallback(
    (peerId) => {
      if (isCleaningUp.current) {
        console.log('⚠️ Skipping peer creation during cleanup');
        return null;
      }

      // 🔥 FIX: Always close and recreate (no reuse)
      if (peerConnections.current[peerId]) {
        console.log(`🔄 Closing existing PC for ${peerId} before creating new one`);
        cleanupPeer(peerId, 'recreate');
      }

      console.log(`🔗 Creating NEW peer connection for: ${peerId} (polite: ${isPolite(peerId)})`);

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
            if (!pc.remoteDescription) {
              console.log(`🧊 Buffering ICE candidate for ${peerId} (no remote desc)`);
              if (!pendingCandidates.current[peerId]) {
                pendingCandidates.current[peerId] = [];
              }
              pendingCandidates.current[peerId].push(event.candidate);
              return;
            }
            
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
              retryAttempts.current[peerId] = 0;
              
              if (connectionTimeouts.current[peerId]) {
                clearTimeout(connectionTimeouts.current[peerId]);
                delete connectionTimeouts.current[peerId];
              }
              break;

            case 'failed':
              console.log(`⚠️ Connection failed with ${peerId}`);
              
              // 🔥 Check if peer still in room
              if (!activeParticipants.current.has(peerId)) {
                console.log(`   Peer ${peerId} not in room, cleaning up`);
                cleanupPeer(peerId, 'not-in-room');
                return;
              }
              
              const attempts = retryAttempts.current[peerId] || 0;
              
              if (attempts < 3) {
                retryAttempts.current[peerId] = attempts + 1;
                const delay = 2000 * Math.pow(2, attempts);
                console.log(`   Retry attempt ${attempts + 1}/3 in ${delay}ms`);
                
                setTimeout(() => {
                  if (!isCleaningUp.current && activeParticipants.current.has(peerId)) {
                    cleanupPeer(peerId, 'retry');
                    callPeer(peerId);
                  }
                }, delay);
              } else {
                console.error(`❌ Max retry attempts reached for ${peerId}`);
                cleanupPeer(peerId, 'max-retries');
                setConnectionStatus('error');
              }
              break;

            case 'disconnected':
              console.log(`⚠️ Peer ${peerId} disconnected`);
              
              // 🔥 Check if peer still in room before attempting reconnect
              if (!activeParticipants.current.has(peerId)) {
                console.log(`   Peer ${peerId} left room, cleaning up immediately`);
                cleanupPeer(peerId, 'left-room');
                return;
              }
              
              // Grace period for temporary disconnection
              connectionTimeouts.current[peerId] = setTimeout(() => {
                if (pc.connectionState === 'disconnected' && !isCleaningUp.current) {
                  if (activeParticipants.current.has(peerId)) {
                    console.log(`   Attempting to reconnect to ${peerId}`);
                    cleanupPeer(peerId, 'reconnect-after-disconnect');
                    callPeer(peerId);
                  } else {
                    console.log(`   Peer ${peerId} no longer in room`);
                    cleanupPeer(peerId, 'timeout-not-in-room');
                  }
                }
              }, 5000);
              break;

            case 'closed':
              console.log(`❌ Connection closed with ${peerId}`);
              cleanupPeer(peerId, 'closed');
              break;
          }
        };

        pc.oniceconnectionstatechange = () => {
          console.log(`🧊 ICE connection state with ${peerId}:`, pc.iceConnectionState);
          
          if (pc.iceConnectionState === 'failed' && !isCleaningUp.current) {
            if (activeParticipants.current.has(peerId)) {
              console.log(`🔄 ICE connection failed for ${peerId}, restarting...`);
              try {
                pc.restartIce();
              } catch (error) {
                console.error('ICE restart failed:', error);
              }
            }
          }
        };

        pc.onicegatheringstatechange = () => {
          console.log(`🧊 ICE gathering state with ${peerId}:`, pc.iceGatheringState);
        };

        pc.onsignalingstatechange = () => {
          console.log(`📡 Signaling state with ${peerId}:`, pc.signalingState);
        };

        // Initialize pending candidates queue
        pendingCandidates.current[peerId] = [];
        makingOffer.current[peerId] = false;

        // Store connection
        peerConnections.current[peerId] = pc;
        return pc;

      } catch (error) {
        console.error(`❌ Error creating peer connection for ${peerId}:`, error);
        return null;
      }
    },
    [localStream, roomId, isPolite, cleanupPeer]
  );

  // ==========================================
  // CALL PEER (Initiate connection)
  // ==========================================
  const callPeer = useCallback(
    async (peerId) => {
      if (isCleaningUp.current) return;
      
      // 🔥 Check if peer is in active participants
      if (!activeParticipants.current.has(peerId)) {
        console.log(`⚠️ Not calling ${peerId} - not in active participants`);
        return;
      }
      
      if (makingOffer.current[peerId]) {
        console.log(`⚠️ Already making offer to ${peerId}, skipping`);
        return;
      }

      console.log(`📞 Calling peer: ${peerId}`);
      setConnectionStatus('connecting');

      const pc = createPeerConnection(peerId);
      if (!pc) {
        console.error('Failed to create peer connection');
        return;
      }

      try {
        makingOffer.current[peerId] = true;
        
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });

        // 🔥 Check if still relevant
        if (!activeParticipants.current.has(peerId)) {
          console.log(`⚠️ Peer ${peerId} left during offer creation`);
          cleanupPeer(peerId, 'left-during-offer');
          return;
        }

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
      } finally {
        makingOffer.current[peerId] = false;
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
      
      // 🔥 Ignore if not in participants
      if (!activeParticipants.current.has(fromUserId)) {
        console.log(`⚠️ Ignoring offer from ${fromUserId} - not in participants`);
        return;
      }

      console.log(`📥 Received offer from ${fromUserId}`);
      setConnectionStatus('connecting');

      let pc = peerConnections.current[fromUserId];
      
      const polite = isPolite(fromUserId);
      const offerCollision = makingOffer.current[fromUserId] || 
                            (pc && pc.signalingState !== 'stable');

      if (!polite && offerCollision) {
        console.log(`⚠️ Ignoring offer from ${fromUserId} (impolite, collision)`);
        return;
      }

      if (polite && offerCollision) {
        console.log(`🔄 Rollback for ${fromUserId} (polite, collision)`);
        if (pc && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setLocalDescription({ type: 'rollback' });
            makingOffer.current[fromUserId] = false;
          } catch (error) {
            console.error('Rollback failed:', error);
          }
        }
      }

      // 🔥 Always create fresh PC for incoming offer
      if (pc) {
        console.log(`🔄 Replacing existing PC for ${fromUserId} with fresh one`);
        cleanupPeer(fromUserId, 'new-offer');
      }
      
      pc = createPeerConnection(fromUserId);
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`✅ Remote description set from ${fromUserId}`);

        // Process pending candidates
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

      if (pc.signalingState !== 'have-local-offer') {
        console.warn(`Cannot set remote answer, signaling state is: ${pc.signalingState}`);
        return;
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`✅ Remote description set from ${fromUserId}`);

        // Process pending candidates
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
        console.log(`🧊 Queuing ICE candidate from ${fromUserId}`);
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

    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleCandidate);

    console.log('✅ Socket listeners registered');

    return () => {
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleCandidate);
      console.log('🧹 Socket listeners removed');
    };
  }, [localStream, roomId, createPeerConnection, isPolite, cleanupPeer]);

  // ==========================================
  // 🔥 SYNC ACTIVE PARTICIPANTS (CRITICAL FIX)
  // ==========================================
  useEffect(() => {
    if (!participants || participants.length === 0) {
      console.log('⚠️ No participants, clearing all connections');
      Object.keys(peerConnections.current).forEach(peerId => {
        cleanupPeer(peerId, 'no-participants');
      });
      return;
    }

    // Build set of current participant IDs (excluding self)
    const currentParticipantIds = new Set(
      participants
        .map(p => p.userId)
        .filter(id => id && id !== userId)
    );

    console.log(`👥 Active participants updated:`, Array.from(currentParticipantIds));

    // Update active participants ref
    activeParticipants.current = currentParticipantIds;

    // 🔥 CRITICAL: Clean up connections for departed users
    Object.keys(peerConnections.current).forEach(peerId => {
      if (!currentParticipantIds.has(peerId)) {
        console.log(`👋 Participant ${peerId} left room, cleaning up`);
        cleanupPeer(peerId, 'participant-left');
      }
    });

    // 🔥 Also clean up any stale remoteStreams
    setRemoteStreams(prev => {
      const updated = { ...prev };
      let changed = false;
      
      Object.keys(updated).forEach(streamId => {
        if (!currentParticipantIds.has(streamId)) {
          console.log(`🧹 Removing stale stream for ${streamId}`);
          delete updated[streamId];
          changed = true;
        }
      });
      
      return changed ? updated : prev;
    });

  }, [participants, userId, cleanupPeer]);

  // ==========================================
  // HANDLE NEW PARTICIPANTS
  // ==========================================
  useEffect(() => {
    if (!localStream || !participants.length || isCleaningUp.current) return;

    const timer = setTimeout(() => {
      if (isCleaningUp.current) return;

      participants.forEach((participant) => {
        const participantId = participant.userId;
        
        if (participantId === userId) return;

        const pc = peerConnections.current[participantId];
        
        // 🔥 Only initiate if no PC or PC is not connected/connecting
        if (!pc || (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting')) {
          console.log(`👤 Initiating connection to: ${participant.username} (${participantId})`);
          callPeer(participantId);
        } else {
          console.log(`   Connection to ${participantId} exists (${pc.connectionState})`);
        }
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
    connectionStatus,
    toggleVideo,
    toggleAudio,
    cleanupConnections,
  };
};

export default useWebRTC;