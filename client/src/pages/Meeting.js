import React, { useState, useEffect } from 'react';
import api from '../api'; 
import { socket } from '../socket.js';
import ChatBox from "../components/ChatBox";
import useWebRTC from '../hooks/useWebRTC';
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

    // 🎥 WebRTC Hook
    const {
        localStream,
        remoteStreams,
        isVideoEnabled,
        isAudioEnabled,
        toggleVideo,
        toggleAudio
    } = useWebRTC(
        joined ? meetingId : null,  // Only activate WebRTC when joined
        user?._id || user?.id,
        participants
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

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);

        if (socket.connected) {
            console.log("🟢 Socket already connected:", socket.id);
            setSocketConnected(true);
        }

        return () => {
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
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

        socket.on("participants-updated", (updatedList) => {
            console.log("👥 Participants updated:", updatedList);
            setParticipants(updatedList || []);
        });

        socket.on("user-connected", (data) => {
            console.log("👤 New user connected:", data);
        });

        socket.on("user-disconnected", (data) => {
            console.log("👋 User disconnected:", data);
        });

        socket.on("left-success", (data) => {
            console.log("🚪 You left the room:", data);
            setJoined(false);
            setParticipants([]);
            setHostId(null);
            setMsg(`You left the meeting (${data.roomId}).`);
            localStorage.removeItem("currentRoomId");
        });

        socket.on("meeting-ended", (data) => {
            console.log("🛑 Meeting ended:", data);
            alert(data.message || "Meeting ended by host.");
            setJoined(false);
            setParticipants([]);
            setHostId(null);
            setMsg("Meeting ended by host.");
            localStorage.removeItem("currentRoomId");
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

        return () => {
            socket.off("joined-success");
            socket.off("participants-updated");
            socket.off("user-connected");
            socket.off("user-disconnected");
            socket.off("left-success");
            socket.off("meeting-ended");
            socket.off("join-error");
            socket.off("error");
        };
    }, [user]);

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

    const handleEndMeeting = () => {
        if (!meetingId || !user) return;

        const userId = (user._id || user.id).toString();
        console.log("🛑 Ending meeting:", { roomId: meetingId, hostId: userId });

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

    const isHost = user && hostId && (
        (user._id?.toString() === hostId.toString()) ||
        (user.id?.toString() === hostId.toString())
    );

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
                Video: {isVideoEnabled ? "🟢 On" : "🔴 Off"} | 
                Audio: {isAudioEnabled ? "🟢 On" : "🔴 Off"}
            </div>

            <p style={{ 
                textAlign: "center", 
                color: msg.includes("Error") ? "red" : "black" 
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

                    {/* 🎥 VIDEO SECTION */}
                    <VideoGrid
                        localStream={localStream}
                        remoteStreams={remoteStreams}
                        participants={participants}
                        currentUserId={user?._id || user?.id}
                    />

                    {/* 🎛️ MEDIA CONTROLS */}
                    <MediaControls
                        isVideoEnabled={isVideoEnabled}
                        isAudioEnabled={isAudioEnabled}
                        onToggleVideo={toggleVideo}
                        onToggleAudio={toggleAudio}
                    />

                    {/* 👥 PARTICIPANTS LIST */}
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

                    {/* 💬 CHAT BOX */}
                    <ChatBox roomId={meetingId} user={user} />

                    {/* 🚪 MEETING CONTROLS */}
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
                            <button
                                onClick={handleEndMeeting}
                                style={{
                                    padding: "10px 20px",
                                    backgroundColor: "#dc3545",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "4px",
                                    cursor: "pointer"
                                }}
                            >
                                🛑 End Meeting (Host)
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default Meeting;