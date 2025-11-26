import React, { useState, useEffect } from 'react';
import api from '../api'; 
import { socket } from '../socket.js';
import ChatBox from "../components/ChatBox";
import useWebRTC from '../hooks/useWebRTC';
import useRecording from '../hooks/useRecording';
import VideoGrid from '../components/VideoGrid';
import MediaControls from '../components/MediaControls';

const Meeting = () => {
    const [meetingId, setMeetingId] = useState('');
    const [createdRoom, setCreatedRoom] = useState(null);
    const [joined, setJoined] = useState(false);
    const [participants, setParticipants] = useState([]);
    const [user, setUser] = useState(null);
    const [msg, setMsg] = useState("");
    const [hostId, setHostId] = useState(null);
    const [socketConnected, setSocketConnected] = useState(false);

    // WebRTC Hook
    const {
        localStream,
        remoteStreams,
        isVideoEnabled,
        isAudioEnabled,
        connectionStatus,
        toggleVideo,
        toggleAudio,
        cleanupConnections 
    } = useWebRTC(
        joined ? meetingId : null,
        user?._id || user?.id,
        participants
    );

    // Recording Hook
    const {
        isRecording,
        recordingError,
        stats,
        startRecording,
        stopRecording,
        downloadLocalRecording
    } = useRecording(
        localStream,
        meetingId,
        user?._id || user?.id
    );

    // Fetch current user
    useEffect(() => {
        let mounted = true;
        api.get("/auth/me", { withCredentials: true })
            .then((res) => {
                if (!mounted) return;
                console.log("✅ User fetched:", res.data.user);
                setUser(res.data.user);
            })
            .catch((err) => {
                if (!mounted) return;
                console.error("❌ User fetch failed:", err);
                setUser(null);
                setMsg("Not logged in. Please login to create/join meetings.");
            });
        return () => (mounted = false);
    }, []);

    // Socket connection status
    useEffect(() => {
        const handleConnect = () => {
            console.log("🟢 Socket connected:", socket.id);
            setSocketConnected(true);
        };

        const handleDisconnect = () => {
            console.log("🔴 Socket disconnected");
            setSocketConnected(false);
        };
        
        // 🔥 FIX: Handle ping/pong for health check
        const handlePing = () => {
            socket.emit('pong');
        };

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);
        socket.on("ping", handlePing);

        if (socket.connected) {
            console.log("🟢 Socket already connected:", socket.id);
            setSocketConnected(true);
        }

        return () => {
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
            socket.off("ping", handlePing);
        };
    }, []);

    // Socket listeners
    useEffect(() => {
        if (!user) return;

        console.log("Setting up socket listeners for user:", user.username);

        socket.on("joined-success", (data) => {
            console.log("✅ Joined room successfully:", data);
            setParticipants(data.participants || []);
            setHostId(data.hostId);
            setJoined(true);
            setMsg(`Successfully joined room ${data.roomId}`);
        });

        // 🔥 FIX: Handle participants update with deduplication
        socket.on("participants-updated", (updatedList) => {
            console.log("👥 Participants updated:", updatedList);
            
            // Deduplicate participants by userId
            const uniqueParticipants = updatedList.filter((participant, index, self) =>
                index === self.findIndex((p) => p.userId === participant.userId)
            );
            
            setParticipants(uniqueParticipants || []);
        });

        socket.on("user-connected", (data) => {
            console.log("👤 New user connected:", data);
        });

        socket.on("user-disconnected", (data) => {
            console.log("👋 User disconnected:", data);
        });
        
        // 🔥 FIX: Handle host transfer
        socket.on("host-transferred", (data) => {
            console.log("👑 Host role transferred to:", data.newHostId);
            setHostId(data.newHostId);
            
            if (data.newHostId === (user._id || user.id).toString()) {
                setMsg("You are now the host of this meeting");
            } else {
                setMsg("Host role has been transferred");
            }
        });

        socket.on("left-success", (data) => {
            console.log("🚪 You left the room:", data);
            setJoined(false);
            setParticipants([]);
            setHostId(null);
            setMsg(`You left the meeting (${data.roomId}).`);
            localStorage.removeItem("currentRoomId");
        });

        // 🔥 FIX: Enhanced meeting-ended handler
        socket.on("meeting-ended", (data) => {
            console.log("🛑 Meeting ended:", data);

            // Stop recording if active
            if (isRecording) {
                try {
                    stopRecording();
                } catch (err) {
                    console.error("Error stopping recording:", err);
                }
            }

            // 🔥 FIX: Force complete WebRTC cleanup
            try {
                cleanupConnections();
            } catch (err) {
                console.error("Cleanup failed:", err);
            }

            alert(data.message || "Meeting ended by host.");

            // Update state
            setJoined(false);
            setParticipants([]);
            setHostId(null);
            setMsg(data.message || "Meeting ended.");
            localStorage.removeItem("currentRoomId");

            // Redirect after cleanup
            setTimeout(() => {
                window.location.href = "/dashboard";
            }, 1000);
        });

        socket.on("join-error", (data) => {
            console.error("❌ Join error:", data);
            alert(data.message || "Unable to join meeting");
            setMsg(data.message || "Unable to join meeting");
            setJoined(false);
            localStorage.removeItem("currentRoomId");
        });

        socket.on("error", (data) => {
            console.error("❌ Socket error:", data);
            alert(data.message || "An error occurred");
        });

        // Recording events
        socket.on("recording-started", (data) => {
            console.log("🎬 Host started recording:", data);
            if (!isRecording) {
                startRecording();
            }
            setMsg("🔴 Recording started by host");
        });

        socket.on("recording-stopped", (data) => {
            console.log("🛑 Host stopped recording:", data);
            if (isRecording) {
                stopRecording();
            }
            setMsg("⏹️ Recording stopped by host");
        });

        return () => {
            socket.off("joined-success");
            socket.off("participants-updated");
            socket.off("user-connected");
            socket.off("user-disconnected");
            socket.off("host-transferred");
            socket.off("left-success");
            socket.off("meeting-ended");
            socket.off("join-error");
            socket.off("error");
            socket.off("recording-started");
            socket.off("recording-stopped");
        };
    }, [user, isRecording, startRecording, stopRecording, cleanupConnections]);

    const handleCreateMeeting = async () => {
        if (!user) {
            return alert("You must be logged in to create a meeting.");
        }

        if (!socketConnected) {
            return alert("Socket not connected. Please refresh the page.");
        }

        try {
            console.log("📝 Creating meeting...");
            const res = await api.post(
                "/meetings/create",
                { title: `${user.username}'s Meeting` },
                { withCredentials: true }
            );

            const returnedRoomId = res.data.meeting.roomId;
            console.log("✅ Meeting created:", returnedRoomId);
            
            handleJoinMeeting(returnedRoomId);
            setCreatedRoom(returnedRoomId);
            setMeetingId(returnedRoomId);
            setMsg(`Meeting created — Room ID: ${returnedRoomId}. Click "Join Meeting" to enter.`);

        } catch (err) {
            console.error("❌ Create meeting error:", err);
            alert(err.response?.data?.message || "Error creating meeting");
        }
    };

    const handleJoinMeeting = async (useId = null) => {
        if (!user) {
            return alert("You must be logged in to join a meeting.");
        }

        if (!socketConnected) {
            return alert("Socket not connected. Please refresh the page.");
        }

        const roomToJoin = useId || meetingId;
        if (!roomToJoin) {
            return alert("Enter or create a valid Room ID to join.");
        }

        console.log("🚪 Attempting to join meeting:", roomToJoin);

        try {
            console.log("📡 Calling API to verify meeting...");
            const response = await api.post(
                `/meetings/join/${roomToJoin}`,
                {},
                { withCredentials: true }
            );
            console.log("✅ API verification successful:", response.data);

            const userId = (user._id || user.id).toString();
            console.log("📤 Emitting join-room socket event:", {
                roomId: roomToJoin,
                userId: userId,
                username: user.username
            });

            socket.emit("join-room", {
                roomId: roomToJoin,
                userId: userId,
                username: user.username,
            });

            setMeetingId(roomToJoin);
            localStorage.setItem("currentRoomId", roomToJoin);
            setMsg(`Joining room ${roomToJoin}...`);

        } catch (error) {
            console.error("❌ Join error:", error);
            const errorMsg = error.response?.data?.message || error.message;
            alert("Error joining meeting: " + errorMsg);
            localStorage.removeItem("currentRoomId");
        }
    };

    const handleLeaveMeeting = () => {
        if (!meetingId || !user) return;

        if (isRecording) {
            stopRecording();
        }
        
        // 🔥 FIX: Cleanup WebRTC before leaving
        cleanupConnections();

        const userId = (user._id || user.id).toString();
        console.log("🚪 Leaving meeting:", { roomId: meetingId, userId });

        socket.emit("leave-room", {
            roomId: meetingId,
            userId: userId,
        });

        setJoined(false);
        setParticipants([]);
        setHostId(null);
        setMsg("Leaving meeting...");
        localStorage.removeItem("currentRoomId");
    };

    const handleEndMeeting = async () => {
        if (!meetingId || !user) return;

        if (isRecording) {
            handleStopRecording();
        }

        const userId = (user._id || user.id).toString();
        console.log("🛑 Ending meeting:", { roomId: meetingId, hostId: userId });

        try {
            await api.post(
                `/meetings/end/${meetingId}`,
                {},
                { withCredentials: true }
            );
        } catch (error) {
            console.log("error in ending meeting", error);
        }

        socket.emit("end-meeting", {
            roomId: meetingId,
            hostId: userId,
        });

        setMsg("Ending meeting for everyone...");
        setJoined(false);
        setParticipants([]);
        setHostId(null);
        localStorage.removeItem("currentRoomId");
    };

    // Recording handlers
    const handleStartRecording = () => {
        if (!localStream) {
            alert("Please wait for camera to initialize");
            return;
        }

        if (isRecording) {
            alert("Already recording");
            return;
        }

        console.log("🎬 Host starting recording for all participants");

        socket.emit("start-recording", {
            roomId: meetingId,
            hostId: user._id || user.id
        });

        startRecording();
        setMsg("🔴 Recording started");
    };

    const handleStopRecording = () => {
        if (!isRecording) {
            alert("No active recording");
            return;
        }

        console.log("🛑 Host stopping recording for all participants");

        socket.emit("stop-recording", {
            roomId: meetingId,
            hostId: user._id || user.id
        });

        setMsg("⏹️ Recording stopped");
    };

    const handleMergeRecording = async () => {
        if (!meetingId) {
            alert("No meeting ID");
            return;
        }
        
        const confirmMerge = window.confirm(
            "This will merge all recordings into one video. Continue?"
        );
        
        if (!confirmMerge) return;
        
        try {
            setMsg("⏳ Merging recordings... This may take a few minutes.");
            
            console.log("🎬 Triggering merge for meeting:", meetingId);
            
            const response = await api.post(`/recordings/merge/${meetingId}`);
            
            console.log("✅ Merge response:", response.data);
            
            setMsg(`✅ Recording merged successfully! Size: ${response.data.fileSizeMB} MB`);
            
            alert(`Recording ready! Click "Download Recording" to save it.`);
            
        } catch (error) {
            console.error("❌ Merge error:", error);
            setMsg("❌ Error merging recording");
            alert("Error merging recording: " + (error.response?.data?.message || error.message));
        }
    };

    const handleDownloadRecording = async () => {
        if (!meetingId) return alert("No meeting ID");

        try {
            setMsg("⏳ Downloading recording...");

            const response = await api.get(`/recordings/download/${meetingId}`, {
                responseType: "blob",
            });

            const blob = new Blob([response.data], { type: "video/mp4" });
            const url = window.URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = `recording-${meetingId}.mp4`;
            document.body.appendChild(a);
            a.click();
            a.remove();

            setMsg("✅ Download complete!");
        } catch (error) {
            console.error("❌ Download error:", error);
            setMsg("❌ Error downloading recording");
            alert(error.response?.data?.message || error.message);
        }
    };

    const isHost = user && hostId && (
        (user._id?.toString() === hostId.toString()) ||
        (user.id?.toString() === hostId.toString())
    );

    const formatDuration = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const getConnectionStatusDisplay = () => {
        switch(connectionStatus) {
            case 'connected':
                return { icon: '🟢', text: 'Connected', color: '#4CAF50' };
            case 'connecting':
                return { icon: '🟡', text: 'Connecting...', color: '#FFC107' };
            case 'ready':
                return { icon: '🔵', text: 'Ready', color: '#2196F3' };
            case 'error':
                return { icon: '🔴', text: 'Error', color: '#F44336' };
            default:
                return { icon: '⚪', text: 'Disconnected', color: '#9E9E9E' };
        }
    };

    const statusDisplay = getConnectionStatusDisplay();

    return (
        <div style={{ padding: "20px", maxWidth: "1400px", margin: "0 auto" }}>
            <h2 style={{ textAlign: "center" }}>🎥 Meeting Room</h2>
            
            {/* Debug Info */}
            <div style={{ 
                background: "#f0f0f0", 
                padding: "10px", 
                margin: "10px auto", 
                maxWidth: "600px",
                fontSize: "12px",
                textAlign: "left",
                borderRadius: "4px"
            }}>
                <strong>Debug Info:</strong><br />
                Socket: {socketConnected ? "🟢 Connected" : "🔴 Disconnected"}<br />
                User: {user ? `✅ ${user.username}` : "❌ Not logged in"}<br />
                Joined: {joined ? "✅ Yes" : "❌ No"}<br />
                Room ID: {meetingId || "None"}<br />
                Participants: {participants.length}<br />
                
                <span style={{ color: statusDisplay.color, fontWeight: 'bold' }}>
                    WebRTC: {statusDisplay.icon} {statusDisplay.text}
                </span><br />
                
                Video: {isVideoEnabled ? "🟢 On" : "🔴 Off"} | 
                Audio: {isAudioEnabled ? "🟢 On" : "🔴 Off"}<br />
                
                <strong>Recording:</strong> {isRecording ? "🔴 Active" : "⚫ Inactive"}<br />
                {isRecording && (
                    <>
                        Duration: {formatDuration(stats.recordingDuration)}<br />
                        Chunks: {stats.chunksRecorded} recorded, {stats.chunksUploaded} uploaded<br />
                        Size: {(stats.totalSize / 1024 / 1024).toFixed(2)} MB
                    </>
                )}
                {recordingError && (
                    <span style={{ color: 'red' }}>Error: {recordingError}</span>
                )}
            </div>

            <p style={{ 
                textAlign: "center", 
                color: msg.includes("Error") || msg.includes("❌") ? "red" : "black" 
            }}>{msg}</p>

            {!joined ? (
                <div style={{ textAlign: "center" }}>
                    <div style={{ marginBottom: 20 }}>
                        <button 
                            onClick={handleCreateMeeting} 
                            style={{ 
                                marginRight: 10,
                                padding: "10px 20px",
                                fontSize: "16px",
                                cursor: "pointer"
                            }}
                            disabled={!user || !socketConnected}
                        >
                            Create New Meeting
                        </button>
                        <span style={{ marginLeft: 10, color: "#666" }}>
                            {!user ? "(Login required)" : !socketConnected ? "(Socket disconnected)" : ""}
                        </span>
                    </div>

                    <div style={{ marginTop: 20 }}>
                        <input
                            type="text"
                            placeholder="Enter Room ID"
                            value={meetingId}
                            onChange={(e) => setMeetingId(e.target.value)}
                            style={{ padding: 8, width: 300 }}
                        />
                        <button
                            onClick={() => handleJoinMeeting()}
                            style={{ marginLeft: 8, padding: "8px 12px" }}
                            disabled={!user || !socketConnected || !meetingId}
                        >
                            Join Meeting
                        </button>
                    </div>

                    {createdRoom && (
                        <div style={{ 
                            marginTop: 12, 
                            padding: "15px", 
                            background: "#e8f5e9",
                            maxWidth: "500px",
                            margin: "20px auto",
                            borderRadius: "8px"
                        }}>
                            <p style={{ margin: 0 }}>
                                ✅ Meeting created successfully!
                            </p>
                            <p style={{ margin: "10px 0" }}>
                                Room ID: <strong style={{ fontSize: "18px" }}>{createdRoom}</strong>
                            </p>
                            <button 
                                onClick={() => handleJoinMeeting(createdRoom)}
                                style={{ 
                                    padding: "10px 20px",
                                    backgroundColor: "#4CAF50",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "4px",
                                    cursor: "pointer"
                                }}
                            >
                                Join This Meeting Now
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <h3 style={{ textAlign: "center" }}>📍 Meeting Room: {meetingId}</h3>

                    {/* Connection Status Banner */}
                    {connectionStatus !== 'connected' && (
                        <div style={{
                            padding: '10px',
                            backgroundColor: statusDisplay.color + '20',
                            border: `2px solid ${statusDisplay.color}`,
                            borderRadius: '6px',
                            textAlign: 'center',
                            marginBottom: '20px',
                            fontSize: '14px',
                            fontWeight: '600'
                        }}>
                            {statusDisplay.icon} {statusDisplay.text}
                            {connectionStatus === 'connecting' && ' - Please wait...'}
                        </div>
                    )}

                    {/* VIDEO SECTION */}
                    <VideoGrid
                        localStream={localStream}
                        remoteStreams={remoteStreams}
                        participants={participants}
                        currentUserId={user?._id || user?.id}
                    />

                    {/* MEDIA CONTROLS */}
                    <MediaControls
                        isVideoEnabled={isVideoEnabled}
                        isAudioEnabled={isAudioEnabled}
                        onToggleVideo={toggleVideo}
                        onToggleAudio={toggleAudio}
                    />

                    {/* RECORDING CONTROLS (Host Only) */}
                    {isHost && (
                        <div style={{
                            display: 'flex',
                            gap: '10px',
                            justifyContent: 'center',
                            alignItems: 'center',
                            padding: '15px',
                            backgroundColor: '#fff3cd',
                            borderRadius: '8px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            marginBottom: '20px'
                        }}>
                            {!isRecording ? (
                                <button
                                    onClick={handleStartRecording}
                                    disabled={!localStream}
                                    style={{
                                        padding: '12px 24px',
                                        fontSize: '16px',
                                        fontWeight: '600',
                                        backgroundColor: '#dc3545',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: localStream ? 'pointer' : 'not-allowed',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                >
                                    <span>🔴</span>
                                    <span>Start Recording</span>
                                </button>
                            ) : (
                                <>
                                    <button
                                        onClick={handleStopRecording}
                                        style={{
                                            padding: '12px 24px',
                                            fontSize: '16px',
                                            fontWeight: '600',
                                            backgroundColor: '#6c757d',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        <span>⏹️</span>
                                        <span>Stop Recording</span>
                                    </button>
                                    
                                    <div style={{
                                        padding: '8px 16px',
                                        backgroundColor: '#fff',
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                        border: '2px solid #dc3545'
                                    }}>
                                        <span style={{ color: '#dc3545', fontWeight: 'bold' }}>●</span>
                                        {' '}Recording: {formatDuration(stats.recordingDuration)}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Recording Status for Non-Host */}
                    {!isHost && isRecording && (
                        <div style={{
                            padding: '10px',
                            backgroundColor: '#ffe6e6',
                            borderRadius: '6px',
                            textAlign: 'center',
                            marginBottom: '20px',
                            fontSize: '14px'
                        }}>
                            <span style={{ color: '#dc3545', fontWeight: 'bold' }}>● REC</span>
                            {' '}This meeting is being recorded
                        </div>
                    )}

                    {/* PARTICIPANTS LIST */}
                    <div style={{ 
                        margin: "20px auto", 
                        maxWidth: "400px",
                        backgroundColor: "#fff",
                        padding: "15px",
                        borderRadius: "8px"
                    }}>
                        <strong>Participants ({participants.length}):</strong>
                        <ul style={{ listStyle: "none", padding: 0 }}>
                            {participants.length === 0 ? (
                                <li style={{ color: "#999" }}>Loading participants...</li>
                            ) : (
                                participants.map((p) => (
                                    <li key={p.userId} style={{ padding: "5px" }}>
                                        {p.username}
                                        {p.userId === hostId && " 👑 (Host)"}
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>

                    {/* CHAT BOX */}
                    <ChatBox roomId={meetingId} user={user} />

                    {/* MEETING CONTROLS */}
                    <div style={{ marginTop: 20, textAlign: "center" }}>
                        <button 
                            onClick={handleLeaveMeeting}
                            style={{ 
                                padding: "10px 20px",
                                marginRight: "10px",
                                cursor: "pointer"
                            }}
                        >
                            Leave Meeting
                        </button>

                        {isHost && (
                            <>
                                <button
                                    onClick={handleEndMeeting}
                                    style={{
                                        padding: "10px 20px",
                                        backgroundColor: "#dc3545",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "4px",
                                        cursor: "pointer",
                                        marginRight: "10px"
                                    }}
                                >
                                    🛑 End Meeting (Host)
                                </button>
                                
                                {stats.chunksRecorded > 0 && (
                                    <button
                                        onClick={downloadLocalRecording}
                                        style={{
                                            padding: "10px 20px",
                                            backgroundColor: "#28a745",
                                            color: "white",
                                            border: "none",
                                            borderRadius: "4px",
                                            cursor: "pointer"
                                        }}
                                    >
                                        💾 Download Local Backup
                                    </button>
                                )}
                            </>
                        )}

                        {isHost && stats.chunksRecorded > 0 && !isRecording && (
                            <div style={{
                                display: 'flex',
                                gap: '10px',
                                justifyContent: 'center',
                                padding: '15px',
                                backgroundColor: '#d4edda',
                                borderRadius: '8px',
                                marginTop: '20px'
                            }}>
                                <button
                                    onClick={handleMergeRecording}
                                    style={{
                                        padding: '12px 24px',
                                        fontSize: '16px',
                                        fontWeight: '600',
                                        backgroundColor: '#28a745',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    🎬 Merge Recordings
                                </button>
                                
                                <button
                                    onClick={handleDownloadRecording}
                                    style={{
                                        padding: '12px 24px',
                                        fontSize: '16px',
                                        fontWeight: '600',
                                        backgroundColor: '#007bff',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    📥 Download Recording
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default Meeting;