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
    process.env.FRONTEND_URL // Will be set on Render
];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, Postman, etc.)
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
    allowEIO3: true
});

console.log("🔌 Socket.io server initialized");
console.log("📡 CORS origin allowed: http://localhost:3000");

io.socketUserMap = new Map();

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

    // Check if already exists
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


io.on("connection", (socket) => {
    console.log(`✅ New Client Connected: ${socket.id}`);

    // This ADDS webrtc event listeners to the SAME socket
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

            // Store socket mapping
            io.socketUserMap.set(socket.id, { userId, username, roomId });

            // Join socket room
            socket.join(roomId);
            console.log(`👤 User ${username} (${userId}) joined room ${roomId}`);

            // Add to DB (handles duplicates internally)
            await addParticipantToMeeting(roomId, userId);

            // Notify others
            socket.to(roomId).emit("user-connected", { userId, username });

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

            // Remove from DB
            await removeParticipantFromMeeting(roomId, userId);

            // Leave socket room
            socket.leave(roomId);
            io.socketUserMap.delete(socket.id);

            // Notify others
            socket.to(roomId).emit("user-disconnected", { userId });

            // Get updated list
            const participants = await fetchParticipantsForRoom(roomId);
            io.in(roomId).emit("participants-updated", participants);

            // Confirm leave
            socket.emit("left-success", { roomId });

            console.log(`✅ User ${userId} left room ${roomId}`);
        } catch (error) {
            console.error("❌ leave-room error:", error);
        }
    });

    // CHAT MESSAGE
    socket.on("send-message", ({ roomId, userId, username, text }) => {
        try{
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

            // Broadcast to everyone in the same meeting
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

            // Verify host
            if (meeting.host.toString() !== hostId.toString()) {
                console.log("❌ Only host can end the meeting");
                socket.emit("error", { message: "Only host can end meeting" });
                return;
            }

            // Mark meeting as inactive
            meeting.isActive = false;
            meeting.participants = [];
            
            await meeting.save();

            // Notify everyone
            io.in(roomId).emit("meeting-ended", {
                message: "Meeting has been ended by the host."
            });

            // Remove all clients from socket room
            const clients = await io.in(roomId).fetchSockets();
            for (const client of clients) {
                client.leave(roomId);
                io.socketUserMap.delete(client.id);
            }

            console.log(`✅ Meeting ${roomId} ended and all participants cleared.`);

        } catch (error) {
            console.error("❌ end-meeting error:", error);
        }
    });

    // DISCONNECT
    socket.on("disconnect", async (reason) => {
        const mapping = io.socketUserMap.get(socket.id);
        if (!mapping) {
            console.log(`Socket ${socket.id} disconnected (no mapping). Reason:`, reason);
            return;
        }

        const { userId, username, roomId } = mapping;
        console.log(`🔌 User ${username} (${userId}) disconnected from room ${roomId}. Reason:`, reason);

        try {
            // Remove from DB
            await removeParticipantFromMeeting(roomId, userId);

            // Notify others
            socket.to(roomId).emit("user-disconnected", { userId, username });

            // Update list
            const participants = await fetchParticipantsForRoom(roomId);
            io.in(roomId).emit("participants-updated", participants);

            io.socketUserMap.delete(socket.id);
        } catch (error) {
            console.error("❌ Error removing participant on disconnect:", error.message);
        }
    });



    // START RECORDING (Host only)
    socket.on("start-recording", async ({ roomId, hostId }) => {
        try {
            console.log(`🎬 Host ${hostId} starting recording in room ${roomId}`);
            
            // Verify host
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
            
            // Notify all participants to start recording
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
            
            // Verify host
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
            
            // Notify all participants to stop recording
            io.in(roomId).emit("recording-stopped", {
                message: "Recording stopped by host",
                stopTime: new Date().toISOString()
            });
            
            console.log(`✅ Recording stopped signal sent to room ${roomId}`);
            
        } catch (error) {
            console.error("❌ stop-recording error:", error);
        }
    });




    socket.on("disconnecting", (reason) => {
        console.log(`⚠️ Socket ${socket.id} disconnecting:`, reason);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});