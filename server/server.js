import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import connectDB from './src/config/db.js';
import userRoutes from "./src/routes/userRoutes.js";
import authRoutes from './src/routes/authRoutes.js';
import meetingRoutes from './src/routes/meetingRoutes.js';
import recordingRoutes from './src/routes/recordingRoutes.js';

import Meeting from './src/models/Meeting.js';

// 🎥 Import WebRTC Handler
import { registerWebRTCHandlers } from './src/webrtc/webrtcHandler.js';

dotenv.config();
const PORT = process.env.PORT || 5000;

connectDB();

const app = express();

const allowedOrigins = [
    'http://localhost:3000',
    process.env.FRONTEND_URL
];

app.use(cors({
    origin: function(origin, callback) {
        if(!origin) return callback(null, true);
        
        if(allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

app.get('/', (req, res) => {
    res.send('Server is running');
});

// Routes
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/meetings", meetingRoutes);
app.use("/api/recordings", recordingRoutes);

// HTTP + SOCKET.io Server
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization']
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

console.log("🔌 Socket.io server initialized");
console.log("📡 CORS origin allowed: http://localhost:3000");

// 🔥 FIX: Enhanced socket mapping with cleanup
io.socketUserMap = new Map();
io.userSocketMap = new Map(); // Reverse mapping for quick lookup

// 🔥 FIX: Active ping-pong health checks
const PING_INTERVAL = 30000; // 30 seconds
const PING_TIMEOUT = 10000; // 10 seconds

// Fetch participants for a room
async function fetchParticipantsForRoom(roomId) {
    const meeting = await Meeting.findOne({ roomId }).populate("participants.user", "username");
    if (!meeting) return [];
    return meeting.participants.map(p => ({
        userId: p.user._id.toString(),
        username: p.user.username,
    }));
}

// Add participant to meeting (with duplicate check)
async function addParticipantToMeeting(roomId, userId) {
    const meeting = await Meeting.findOne({ roomId });
    if (!meeting) throw new Error('Meeting not found');

    if (meeting.participants.some(p => p.user.toString() === userId)) {
        console.log(`User ${userId} already in participants, skipping add.`);
        return meeting;
    }

    const isHost = meeting.host.toString() === userId.toString();
    const role = isHost ? 'host' : 'participant';
    
    console.log(`Adding user ${userId} as ${role}`);

    meeting.participants.push({ user: userId, role: role });
    await meeting.save();
    console.log(`Added user ${userId} to meeting ${roomId}`);
    return meeting;
}

// Remove participant from meeting
async function removeParticipantFromMeeting(roomId, userId) {
    const meeting = await Meeting.findOne({ roomId });
    if (!meeting) return null;

    meeting.participants = meeting.participants.filter(
        p => p.user.toString() !== userId
    );
    await meeting.save();
    console.log(`Removed user ${userId} from meeting ${roomId}`);
    return meeting;
}

// 🔥 FIX: Clean up stale socket for a user
function cleanupStaleSocket(io, userId) {
    const oldSocketId = io.userSocketMap.get(userId);
    if (oldSocketId) {
        console.log(`🧹 Cleaning up stale socket ${oldSocketId} for user ${userId}`);
        io.socketUserMap.delete(oldSocketId);
        
        // Force disconnect old socket if it still exists
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) {
            oldSocket.disconnect(true);
        }
    }
}

// 🔥 FIX: Transfer host role when host disconnects
async function transferHostRole(roomId) {
    try {
        const meeting = await Meeting.findOne({ roomId });
        if (!meeting || meeting.participants.length === 0) {
            return null;
        }

        // Find first non-host participant
        const newHost = meeting.participants.find(p => 
            p.user.toString() !== meeting.host.toString()
        );

        if (newHost) {
            console.log(`👑 Transferring host role to ${newHost.user}`);
            meeting.host = newHost.user;
            
            // Update role
            const hostParticipant = meeting.participants.find(
                p => p.user.toString() === newHost.user.toString()
            );
            if (hostParticipant) {
                hostParticipant.role = 'host';
            }
            
            await meeting.save();
            return newHost.user.toString();
        }

        return null;
    } catch (error) {
        console.error("Error transferring host role:", error);
        return null;
    }
}

io.on("connection", (socket) => {
    console.log(`✅ New Client Connected: ${socket.id}`);

    // 🔥 FIX: Setup ping-pong health check
    let pingTimeout;
    let pingInterval = setInterval(() => {
        socket.emit('ping');
        pingTimeout = setTimeout(() => {
            console.log(`⚠️ Socket ${socket.id} failed ping check, disconnecting`);
            socket.disconnect(true);
        }, PING_TIMEOUT);
    }, PING_INTERVAL);

    socket.on('pong', () => {
        clearTimeout(pingTimeout);
    });

    // Register WebRTC handlers
    registerWebRTCHandlers(io, socket);

    // JOIN ROOM
    socket.on("join-room", async ({ roomId, userId, username }) => {
        try {
            if (!roomId || !userId) {
                socket.emit("join-error", { message: "roomId and userId required" });
                return;
            }

            // Verify meeting exists and is active
            const meeting = await Meeting.findOne({ roomId });
            if (!meeting) {
                socket.emit("join-error", { message: "Meeting not found" });
                return;
            }
            if (meeting.isActive === false) {
                socket.emit("join-error", { message: "Meeting has ended and cannot be joined." });
                return;
            }

            // 🔥 FIX: Clean up stale socket before adding new one
            cleanupStaleSocket(io, userId);

            // Store socket mapping (both directions)
            io.socketUserMap.set(socket.id, { userId, username, roomId });
            io.userSocketMap.set(userId, socket.id);

            // Join socket room
            socket.join(roomId);
            console.log(`👤 User ${username} (${userId}) joined room ${roomId}`);

            // Add to DB
            await addParticipantToMeeting(roomId, userId);

            // 🔥 FIX: Notify others with explicit peer sync request
            socket.to(roomId).emit("user-connected", { 
                userId, 
                username,
                requiresPeerConnection: true 
            });

            // Get updated participants list
            const participants = await fetchParticipantsForRoom(roomId);

            // Broadcast updated list to everyone
            io.in(roomId).emit("participants-updated", participants);

            // Confirm join to the user
            socket.emit("joined-success", {
                roomId,
                participants,
                hostId: meeting.host.toString(),
            });

        } catch (error) {
            console.error("❌ join-room error:", error);
            socket.emit("join-error", { message: "Failed to join room" });
        }
    });

    // LEAVE ROOM
    socket.on("leave-room", async ({ roomId, userId }) => {
        try {
            if (!roomId || !userId) return;

            console.log(`🚪 User ${userId} leaving room ${roomId}`);

            const meeting = await Meeting.findOne({ roomId });
            const isHost = meeting && meeting.host.toString() === userId.toString();

            // Remove from DB
            await removeParticipantFromMeeting(roomId, userId);

            // Leave socket room
            socket.leave(roomId);
            io.socketUserMap.delete(socket.id);
            io.userSocketMap.delete(userId);

            // 🔥 FIX: If host left and meeting still has participants, transfer role
            if (isHost && meeting && meeting.participants.length > 1) {
                const newHostId = await transferHostRole(roomId);
                if (newHostId) {
                    io.in(roomId).emit("host-transferred", { newHostId });
                }
            }

            // Notify others to cleanup peer connections
            socket.to(roomId).emit("user-disconnected", { 
                userId,
                cleanupRequired: true 
            });

            // Get updated list
            const participants = await fetchParticipantsForRoom(roomId);
            io.in(roomId).emit("participants-updated", participants);

            socket.emit("left-success", { roomId });

            console.log(`✅ User ${userId} left room ${roomId}`);
        } catch (error) {
            console.error("❌ leave-room error:", error);
        }
    });

    // CHAT MESSAGE
    socket.on("send-message", ({ roomId, userId, username, text }) => {
        try {
            if (!roomId || !text || !username) {
                socket.emit("error", { message: "Invalid message payload" });
                return;
            }

            const messageData = {
                userId,
                username,
                text,
                timestamp: new Date().toISOString(),
            };

            console.log(`💬 Message from ${username} (${roomId}): ${text}`);

            io.in(roomId).emit("new-message", messageData);
            
        } catch (error) {
            console.error("❌ send-message error:", error);
        }
    });

    // END MEETING (Host only)
    socket.on("end-meeting", async ({ roomId, hostId }) => {
        try {
            if (!roomId || !hostId) return;

            console.log(`🛑 Host ${hostId} ending meeting ${roomId}`);

            const meeting = await Meeting.findOne({ roomId });
            if (!meeting) {
                console.log("Meeting not found");
                return;
            }

            if (meeting.host.toString() !== hostId.toString()) {
                console.log("❌ Only host can end the meeting");
                socket.emit("error", { message: "Only host can end meeting" });
                return;
            }

            // Mark meeting as inactive
            meeting.isActive = false;
            meeting.participants = [];
            await meeting.save();

            // 🔥 FIX: Notify everyone to cleanup WebRTC connections
            io.in(roomId).emit("meeting-ended", {
                message: "Meeting has been ended by the host.",
                forceCleanup: true
            });

            // Remove all clients from socket room and cleanup mappings
            const clients = await io.in(roomId).fetchSockets();
            for (const client of clients) {
                const mapping = io.socketUserMap.get(client.id);
                if (mapping) {
                    io.userSocketMap.delete(mapping.userId);
                }
                io.socketUserMap.delete(client.id);
                client.leave(roomId);
            }

            console.log(`✅ Meeting ${roomId} ended and all participants cleared.`);

        } catch (error) {
            console.error("❌ end-meeting error:", error);
        }
    });

    // 🔥 FIX: Handle disconnecting event for cleanup
    socket.on("disconnecting", async (reason) => {
        console.log(`⚠️ Socket ${socket.id} disconnecting:`, reason);
        
        const mapping = io.socketUserMap.get(socket.id);
        if (!mapping) return;

        const { userId, username, roomId } = mapping;

        try {
            const meeting = await Meeting.findOne({ roomId });
            if (!meeting) return;

            const isHost = meeting.host.toString() === userId.toString();

            // 🔥 FIX: If host disconnects unexpectedly, end meeting
            if (isHost) {
                console.log(`👑 Host ${username} disconnected unexpectedly, ending meeting ${roomId}`);
                
                meeting.isActive = false;
                meeting.participants = [];
                await meeting.save();

                // Notify all participants
                socket.to(roomId).emit("meeting-ended", {
                    message: "Meeting ended: Host disconnected",
                    forceCleanup: true
                });

                // Cleanup all mappings for this room
                const clients = await io.in(roomId).fetchSockets();
                for (const client of clients) {
                    const clientMapping = io.socketUserMap.get(client.id);
                    if (clientMapping) {
                        io.userSocketMap.delete(clientMapping.userId);
                    }
                    io.socketUserMap.delete(client.id);
                }
            } else {
                // Regular participant disconnect
                await removeParticipantFromMeeting(roomId, userId);
                
                socket.to(roomId).emit("user-disconnected", { 
                    userId, 
                    username,
                    cleanupRequired: true 
                });

                const participants = await fetchParticipantsForRoom(roomId);
                io.in(roomId).emit("participants-updated", participants);
            }

            io.socketUserMap.delete(socket.id);
            io.userSocketMap.delete(userId);

        } catch (error) {
            console.error("❌ Error in disconnecting handler:", error);
        }
    });

    // DISCONNECT
    socket.on("disconnect", async (reason) => {
        console.log(`🔴 Socket ${socket.id} disconnected:`, reason);
        
        // Cleanup ping interval
        clearInterval(pingInterval);
        clearTimeout(pingTimeout);

        // Final cleanup
        const mapping = io.socketUserMap.get(socket.id);
        if (mapping) {
            io.socketUserMap.delete(socket.id);
            io.userSocketMap.delete(mapping.userId);
        }
    });

    // START RECORDING (Host only)
    socket.on("start-recording", async ({ roomId, hostId }) => {
        try {
            console.log(`🎬 Host ${hostId} starting recording in room ${roomId}`);
            
            const meeting = await Meeting.findOne({ roomId });
            if (!meeting) {
                console.log("❌ Meeting not found");
                return;
            }
            
            if (meeting.host.toString() !== hostId.toString()) {
                console.log("❌ Only host can start recording");
                socket.emit("error", { message: "Only host can start recording" });
                return;
            }
            
            io.in(roomId).emit("recording-started", {
                message: "Recording started by host",
                startTime: new Date().toISOString()
            });
            
            console.log(`✅ Recording started signal sent to room ${roomId}`);
            
        } catch (error) {
            console.error("❌ start-recording error:", error);
        }
    });

    // STOP RECORDING (Host only)
    socket.on("stop-recording", async ({ roomId, hostId }) => {
        try {
            console.log(`🛑 Host ${hostId} stopping recording in room ${roomId}`);
            
            const meeting = await Meeting.findOne({ roomId });
            if (!meeting) {
                console.log("❌ Meeting not found");
                return;
            }
            
            if (meeting.host.toString() !== hostId.toString()) {
                console.log("❌ Only host can stop recording");
                socket.emit("error", { message: "Only host can stop recording" });
                return;
            }
            
            io.in(roomId).emit("recording-stopped", {
                message: "Recording stopped by host",
                stopTime: new Date().toISOString()
            });
            
            console.log(`✅ Recording stopped signal sent to room ${roomId}`);
            
        } catch (error) {
            console.error("❌ stop-recording error:", error);
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});