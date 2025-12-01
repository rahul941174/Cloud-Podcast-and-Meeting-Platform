import React, { useState, useEffect } from "react";
import api from "../api";
import { socket } from "../socket";
import useWebRTC from "../hooks/useWebRTC";
import useRecording from "../hooks/useRecording";
import VideoGrid from "../components/VideoGrid";
import MediaControls from "../components/MediaControls";
import ChatBox from "../components/ChatBox";

export default function Meeting() {
    const [meetingId, setMeetingId] = useState("");
    const [createdRoom, setCreatedRoom] = useState(null);
    const [joined, setJoined] = useState(false);
    const [participants, setParticipants] = useState([]);
    const [user, setUser] = useState(null);
    const [hostId, setHostId] = useState(null);
    const [msg, setMsg] = useState("");
    const [socketConnected, setSocketConnected] = useState(false);

    const [mergeStatus, setMergeStatus] = useState(null);
    const [downloadUrl, setDownloadUrl] = useState(null);

    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [showTimer, setShowTimer] = useState(false);

    const [messages, setMessages] = useState([]);

    useEffect(() => {
        api.get("/auth/me", { withCredentials: true })
            .then((res) => setUser(res.data.user))
            .catch(() => setUser(null));
    }, []);

    useEffect(() => {
        const onConnect = () => setSocketConnected(true);
        const onDisconnect = () => setSocketConnected(false);

        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);

        if (socket.connected) setSocketConnected(true);

        return () => {
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
        };
    }, []);

    const {
        localStream,
        remoteStreams,
        isVideoEnabled,
        isAudioEnabled,
        toggleVideo,
        toggleAudio,
    } = useWebRTC(joined ? meetingId : null, user?._id, participants);

    const { isRecording, startRecording, stopRecording } =
        useRecording(localStream, meetingId, user?._id);

    useEffect(() => {
        let timer = null;

        if (isRecording) {
            setShowTimer(true);
            timer = setInterval(() => {
                setRecordingSeconds((s) => s + 1);
            }, 1000);
        } else {
            clearInterval(timer);
            setRecordingSeconds(0);
            setShowTimer(false);
        }

        return () => clearInterval(timer);
    }, [isRecording]);

    useEffect(() => {
        if (!user) return;

        socket.off("joined-success");
        socket.off("participants-updated");
        socket.off("meeting-ended");
        socket.off("recording-started");
        socket.off("recording-stopped");
        socket.off("merge-started");
        socket.off("merge-success");
        socket.off("merge-failed");

        const handleChatMessage = (message) => {
            console.log("💬 Received chat message:", message);
            setMessages((prev) => [...prev, message]);
        };

        socket.on("joined-success", (data) => {
            setMeetingId(data.roomId);
            setParticipants(data.participants || []);
            setHostId(data.hostId);
            setJoined(true);
            setMsg(`Joined room ${data.roomId}`);
        });

        socket.on("participants-updated", (list) => setParticipants(list || []));
        socket.on("recording-started", () => startRecording());
        socket.on("recording-stopped", () => stopRecording());

        socket.on("merge-started", () => setMergeStatus("started"));

        socket.on("merge-success", (data) => {
            setMergeStatus("success");
            const backend =
                process.env.REACT_APP_BACKEND_URL ||
                window.location.origin.replace("3000", "5000");

            const url = `${backend}/api/recordings/download/${meetingId}`;
            setDownloadUrl(url);
            setMsg("Final recording ready!");
        });

        socket.on("merge-failed", () => setMergeStatus("failed"));

        socket.on("meeting-ended", () => {
            stopRecording();
            setJoined(false);
            setParticipants([]);
            setHostId(null);
        });

        socket.on("chat:message", handleChatMessage);

        return () => {
            socket.off("chat:message", handleChatMessage);
        };
    }, [user, startRecording, stopRecording]);

    const createMeeting = async () => {
        if (!user) return alert("Login required");

        const res = await api.post("/meetings/create", {}, { withCredentials: true });
        const room = res.data.meeting.roomId;

        setCreatedRoom(room);
        joinMeeting(room);
    };

    const joinMeeting = async (forcedRoomId = null) => {
        const room = forcedRoomId || meetingId;

        if (!room) return alert("Enter Room ID");
        if (!user) return alert("Login required");

        await api.post(`/meetings/join/${room}`, {}, { withCredentials: true });

        socket.emit("join-room", {
            roomId: room,
            userId: user._id,
            username: user.username,
        });
    };

    const leaveMeeting = () => {
        stopRecording();

        socket.emit("leave-room", {
            roomId: meetingId,
            userId: user._id,
        });

        setJoined(false);
        setParticipants([]);
        setHostId(null);
    };

    const endMeeting = () => {
        if (!isHost) return;

        socket.emit("end-meeting", {
            roomId: meetingId,
            hostId: user._id,
        });
    };

    const handleStartRecording = () => {
        socket.emit("start-recording", {
            roomId: meetingId,
            hostId: user._id,
        });
    };

    const handleStopRecording = () => {
        socket.emit("stop-recording", {
            roomId: meetingId,
            hostId: user._id,
        });
    };

    const isHost = user && hostId && user._id === hostId;

    // ===========================================================
    // 🔥 STYLED LAYOUT (BLACK THEME) — header is sticky, left content scrolls
    // ===========================================================
    return (
        <div
            style={{
                width: "100vw",
                height: "100vh",
                background: "#0d0d0d",
                color: "white",
                display: "flex",
                flexDirection: "row",
                overflow: "hidden",
                fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
            }}
        >
            {/* LEFT MAIN AREA */}
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                {/* Sticky Header (always visible) */}
                <div
                    style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 30,
                        background: "linear-gradient(180deg, rgba(13,13,13,0.95), rgba(13,13,13,0.9))",
                        borderBottom: "1px solid rgba(255,255,255,0.03)",
                        padding: "14px 20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                    }}
                >
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: 0.6 }}>
                            Meeting Room
                        </div>
                        <div style={{ fontSize: 13, color: "#bbb" }}>{msg}</div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ textAlign: "right", marginRight: 8 }}>
                            <div style={{ fontSize: 13, color: "#ddd", fontWeight: 600 }}>Room ID</div>
                            <div style={{ fontSize: 13, color: "#99f", wordBreak: "break-all" }}>{meetingId || "-"}</div>
                        </div>

                        {/* Host controls quick */}
                        <div style={{ display: "flex", gap: 8 }}>
                            <button
                                onClick={leaveMeeting}
                                style={{
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                    background: "#222",
                                    color: "#fff",
                                    border: "1px solid rgba(255,255,255,0.04)",
                                    cursor: "pointer",
                                }}
                            >
                                Leave
                            </button>

                            {isHost && (
                                <button
                                    onClick={endMeeting}
                                    style={{
                                        padding: "8px 12px",
                                        borderRadius: 8,
                                        background: "#b91c1c",
                                        color: "white",
                                        border: "none",
                                        cursor: "pointer",
                                    }}
                                >
                                    End
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Scrollable content area (video grid, controls, merge UI) */}
                <div
                    style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                    }}
                >
                    {!joined ? (
                        <div style={{ textAlign: "center", marginTop: 50 }}>
                            <button
                                onClick={createMeeting}
                                style={{
                                    padding: "12px 22px",
                                    background: "#ffffff08",
                                    color: "white",
                                    border: "1px solid #2b2b2b",
                                    borderRadius: 8,
                                    cursor: "pointer",
                                }}
                            >
                                Create Meeting
                            </button>

                            <div style={{ marginTop: 20 }}>
                                <input
                                    type="text"
                                    placeholder="Enter Room ID"
                                    value={meetingId}
                                    onChange={(e) => setMeetingId(e.target.value)}
                                    style={{
                                        padding: "10px",
                                        borderRadius: 6,
                                        background: "#111",
                                        border: "1px solid #333",
                                        color: "white",
                                        marginRight: 8,
                                        width: 320,
                                    }}
                                />
                                <button
                                    onClick={() => joinMeeting()}
                                    style={{
                                        padding: "10px 18px",
                                        background: "#0b84ff",
                                        borderRadius: 6,
                                        color: "white",
                                        border: "none",
                                        cursor: "pointer",
                                    }}
                                >
                                    Join
                                </button>
                            </div>

                            {createdRoom && (
                                <p style={{ marginTop: 20, color: "#ccc" }}>
                                    Room created: {createdRoom}
                                </p>
                            )}
                        </div>
                    ) : (
                        <>
                            <VideoGrid
                                localStream={localStream}
                                remoteStreams={remoteStreams}
                                participants={participants}
                                currentUserId={user?._id}
                            />

                            <MediaControls
                                isVideoEnabled={isVideoEnabled}
                                isAudioEnabled={isAudioEnabled}
                                onToggleVideo={toggleVideo}
                                onToggleAudio={toggleAudio}
                            />

                            {showTimer && (
                                <h3 style={{ color: "#ff6b6b", textAlign: "center" }}>
                                    Recording: {recordingSeconds}s
                                </h3>
                            )}

                            {isHost && (
                                <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
                                    {!isRecording ? (
                                        <button
                                            onClick={handleStartRecording}
                                            style={{
                                                padding: "10px 18px",
                                                borderRadius: 6,
                                                background: "#00cc66",
                                                color: "white",
                                                border: "none",
                                                cursor: "pointer",
                                            }}
                                        >
                                            Start Recording
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleStopRecording}
                                            style={{
                                                padding: "10px 18px",
                                                borderRadius: 6,
                                                background: "#e11d48",
                                                color: "white",
                                                border: "none",
                                                cursor: "pointer",
                                            }}
                                        >
                                            Stop Recording
                                        </button>
                                    )}
                                </div>
                            )}

                            {mergeStatus === "started" && (
                                <h3 style={{ color: "orange", textAlign: "center" }}>
                                    Processing final video…
                                </h3>
                            )}

                            {mergeStatus === "failed" && (
                                <h3 style={{ color: "red", textAlign: "center" }}>
                                    Merge failed.
                                </h3>
                            )}

                            {mergeStatus === "success" && downloadUrl && (
                                <div style={{ textAlign: "center", marginTop: 8 }}>
                                    <a
                                        href={downloadUrl}
                                        download
                                        style={{
                                            padding: "10px 20px",
                                            background: "#00cc66",
                                            color: "white",
                                            borderRadius: 8,
                                            textDecoration: "none",
                                            display: "inline-block",
                                        }}
                                    >
                                        ⬇️ Download Final Recording
                                    </a>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* RIGHT CHAT SIDEBAR — only render when in meeting (joined) */}
            <div
                style={{
                    width: "360px",
                    background: "#0b0b0b",
                    borderLeft: "1px solid #141414",
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 300,
                }}
            >
                {joined ? (
                    <ChatBox roomId={meetingId} user={user} messages={messages} />
                ) : (
                    <div
                        style={{
                            color: "#999",
                            padding: 12,
                            textAlign: "center",
                            marginTop: 24,
                            fontSize: 14,
                        }}
                    >
                        Join a meeting to open the chat.
                    </div>
                )}
            </div>
        </div>
    );
}
