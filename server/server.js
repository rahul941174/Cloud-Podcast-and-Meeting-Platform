// server/server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import connectDB from './src/config/db.js';
import Meeting from './src/models/Meeting.js';
import { requestMerge } from "./src/utils/mergeWorkerClient.js";
import authRoutes from './src/routes/authRoutes.js';
import meetingRoutes from './src/routes/meetingRoutes.js';
import recordingRoutes from './src/routes/recordingRoutes.js';
import fs from 'fs';

dotenv.config();
const PORT = process.env.PORT || 5000;

/**
 * Express app and middleware
 */
const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS not allowed by server'), false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

app.get('/', (req, res) => res.send('API running'));

app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/recordings', recordingRoutes);

connectDB().then(() => {
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.userSocketMap = new Map();
  io.socketUserMap = new Map();

  function socketForUser(userId) {
    const socketId = io.userSocketMap.get(String(userId));
    if (!socketId) return null;
    return io.sockets.sockets.get(socketId) || null;
  }

  async function getParticipantsList(roomId) {
    try {
      const meeting = await Meeting.findOne({ roomId }).populate('participants.user', 'username');
      if (!meeting) return [];
      return meeting.participants.map((p) => ({
        userId: p.user._id.toString(),
        username: p.user.username,
      }));
    } catch (err) {
      console.error('Error fetching participants list:', err.message);
      return [];
    }
  }

  const hostDisconnectTimers = new Map();
  const HOST_DISCONNECT_GRACE_MS = 12000;
  const POST_STOP_UPLOAD_GRACE_MS = 4000;

  async function cleanupRoomAfterEnd(roomId) {
    try {
      const clients = await io.in(roomId).fetchSockets();
      for (const client of clients) {
        const mapping = io.socketUserMap.get(client.id);
        if (mapping) io.userSocketMap.delete(mapping.userId);

        io.socketUserMap.delete(client.id);
        try { client.leave(roomId); } catch {}
      }
    } catch (err) {
      console.error("cleanupRoomAfterEnd error:", err.message);
    }
  }

  async function triggerMergeForRoom(roomId) {
    try {
      io.in(roomId).emit("merge-started", { message: "Merge started" });

      const mergeResult = await requestMerge(roomId);

      io.in(roomId).emit("merge-success", {
        message: "Final video generated",
        finalPath: mergeResult.output || mergeResult.finalPath || null,
      });

      console.log("✅ Merge completed for room:", roomId);
    } catch (err) {
      console.error("❌ Merge failed for room:", roomId, err?.message || err);
      io.in(roomId).emit("merge-failed", {
        message: "Failed to generate final video",
        error: err?.message || String(err),
      });
    }
  }

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    const getSenderInfo = () => {
      const mapping = io.socketUserMap.get(socket.id);
      return mapping
        ? { userId: mapping.userId, username: mapping.username, roomId: mapping.roomId }
        : { userId: null, username: null, roomId: null };
    };

    /* JOIN ROOM */
    socket.on("join-room", async ({ roomId, userId, username }) => {
      try {
        if (!roomId || !userId)
          return socket.emit("join-error", { message: "roomId and userId required" });

        const meeting = await Meeting.findOne({ roomId });
        if (!meeting)
          return socket.emit("join-error", { message: "Meeting not found" });

        if (!meeting.isActive)
          return socket.emit("join-error", { message: "Meeting has ended" });

        io.userSocketMap.set(String(userId), socket.id);
        io.socketUserMap.set(socket.id, { userId: String(userId), username, roomId });

        socket.join(roomId);

        const already = meeting.participants.some(p => p.user.toString() === String(userId));
        if (!already) {
          meeting.participants.push({
            user: userId,
            role: meeting.host.toString() === String(userId) ? "host" : "participant",
          });
          await meeting.save();
        }

        socket.to(roomId).emit("user-connected", {
          userId,
          username,
          requiresPeerConnection: true,
        });

        io.in(roomId).emit("participants-updated", await getParticipantsList(roomId));

        socket.emit("joined-success", {
          roomId,
          participants: await getParticipantsList(roomId),
          hostId: meeting.host.toString(),
        });

      } catch (err) {
        console.error("join-room error:", err.message);
        socket.emit("join-error", { message: "Failed to join room" });
      }
    });

    /* LEAVE ROOM */
    socket.on("leave-room", async ({ roomId, userId }) => {
      try {
        if (!roomId || !userId) return;

        io.userSocketMap.delete(String(userId));
        io.socketUserMap.delete(socket.id);

        socket.leave(roomId);

        const meeting = await Meeting.findOne({ roomId });
        if (meeting) {
          meeting.participants = meeting.participants.filter(
            (p) => p.user.toString() !== String(userId)
          );
          await meeting.save();
          io.in(roomId).emit("participants-updated", await getParticipantsList(roomId));
        }

        socket.to(roomId).emit("user-disconnected", { userId });

        socket.emit("left-success", { roomId });
      } catch (err) {
        console.error("leave-room error:", err.message);
      }
    });

    /* --------------------------------------------------
       FIX 2 — CHAT FALLBACK SUPPORT
       (chat, message, chat:message → all normalized)
    -------------------------------------------------- */
    const normalizeAndBroadcastChat = (payload) => {
      try {
        if (!payload || !payload.roomId || !payload.text) return;

        const finalMessage = {
          roomId: payload.roomId,
          userId: payload.userId || null,
          username: payload.username || null,
          text: payload.text,
          createdAt: payload.createdAt || new Date().toISOString(),
        };

        io.in(finalMessage.roomId).emit("chat:message", finalMessage);
        console.log("💬 Chat broadcast → room:", finalMessage.roomId, "text:", finalMessage.text);

      } catch (err) {
        console.error("chat normalization error:", err);
      }
    };

    socket.on("chat:message", normalizeAndBroadcastChat);
    socket.on("chat", normalizeAndBroadcastChat);
    socket.on("message", normalizeAndBroadcastChat);

    /* WEBRTC */
    socket.on("webrtc:offer", ({ offer, targetUserId }) => {
      try {
        const sender = getSenderInfo();
        const target = socketForUser(targetUserId);
        if (target)
          target.emit("webrtc:offer", { offer, fromUserId: sender.userId });
      } catch (e) {}
    });

    socket.on("webrtc:answer", ({ answer, targetUserId }) => {
      try {
        const sender = getSenderInfo();
        const target = socketForUser(targetUserId);
        if (target)
          target.emit("webrtc:answer", { answer, fromUserId: sender.userId });
      } catch (e) {}
    });

    socket.on("webrtc:ice-candidate", ({ candidate, targetUserId }) => {
      try {
        const sender = getSenderInfo();
        const target = socketForUser(targetUserId);
        if (target)
          target.emit("webrtc:ice-candidate", { candidate, fromUserId: sender.userId });
      } catch (e) {}
    });

    /* --------------------------------------------------
       FIX 1 — START RECORDING SUPPORT (HOST ONLY)
    -------------------------------------------------- */
    socket.on("start-recording", async ({ roomId, hostId }) => {
      try {
        if (!roomId || !hostId) return;

        const meeting = await Meeting.findOne({ roomId });
        if (!meeting)
          return socket.emit("error", { message: "Meeting not found" });

        if (meeting.host.toString() !== String(hostId))
          return socket.emit("error", { message: "Only host can start recording" });

        console.log(`🎬 Host ${hostId} STARTED recording in room ${roomId}`);

        io.in(roomId).emit("recording-started", {
          message: "Recording started by host",
          startTime: new Date().toISOString(),
        });

      } catch (err) {
        console.error("start-recording error:", err);
      }
    });

    /* STOP RECORDING */
    socket.on("stop-recording", async ({ roomId, hostId }) => {
      try {
        const meeting = await Meeting.findOne({ roomId });
        if (!meeting) return;

        if (meeting.host.toString() !== String(hostId)) return;

        io.in(roomId).emit("recording-stopped", { message: "Recording stopped" });

        setTimeout(() => triggerMergeForRoom(roomId), POST_STOP_UPLOAD_GRACE_MS);

      } catch (err) {
        console.error("stop-recording error:", err);
      }
    });

    /* END MEETING */
    socket.on("end-meeting", async ({ roomId, hostId }) => {
      try {
        const meeting = await Meeting.findOne({ roomId });
        if (!meeting) return;

        if (meeting.host.toString() !== String(hostId)) return;

        io.in(roomId).emit("meeting-ended");

        meeting.isActive = false;
        meeting.participants = [];
        await meeting.save();

        setTimeout(async () => {
          triggerMergeForRoom(roomId);
          await cleanupRoomAfterEnd(roomId);
        }, POST_STOP_UPLOAD_GRACE_MS);

      } catch (err) {}
    });

    /* DISCONNECT */
    socket.on("disconnect", async (reason) => {
      const mapping = io.socketUserMap.get(socket.id);
      if (!mapping) return;

      const { userId, roomId } = mapping;

      io.socketUserMap.delete(socket.id);
      io.userSocketMap.delete(String(userId));

      const meeting = await Meeting.findOne({ roomId });
      if (!meeting) return;

      meeting.participants = meeting.participants.filter(
        (p) => p.user.toString() !== String(userId)
      );
      await meeting.save();

      io.in(roomId).emit("participants-updated", await getParticipantsList(roomId));
    });
  });

  server.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
});
