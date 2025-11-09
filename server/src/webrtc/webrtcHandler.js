/**
 * WebRTC Signaling Handler
 * 
 * This file ADDS WebRTC event handlers to existing socket connections.
 * It does NOT create new socket connections!
 * 
 * The server calls this function to register WebRTC-specific event handlers
 * on the same socket that handles meeting/chat events.
 */

/**
 * Register WebRTC event handlers on a socket
 * This gets called for each connected socket from server.js
 */
export const registerWebRTCHandlers = (io, socket) => {
    
    // ==========================================
    // 1️⃣ OFFER - Peer A wants to connect to Peer B
    // ==========================================
    socket.on("webrtc:offer", ({ offer, targetUserId, roomId }) => {
        console.log(`📤 WebRTC Offer from ${socket.id} to ${targetUserId} in room ${roomId}`);
        
        // Find the target user's socket ID
        const targetSocket = findSocketByUserId(io, targetUserId);
        
        if (targetSocket) {
            // Send the offer to the specific target user
            targetSocket.emit("webrtc:offer", {
                offer,
                fromUserId: getSocketUserId(io, socket.id),
                fromSocketId: socket.id
            });
            console.log(`✅ Offer forwarded to ${targetUserId}`);
        } else {
            console.log(`❌ Target user ${targetUserId} not found`);
            socket.emit("webrtc:error", { 
                message: "Target user not found" 
            });
        }
    });

    // ==========================================
    // 2️⃣ ANSWER - Peer B responds to Peer A
    // ==========================================
    socket.on("webrtc:answer", ({ answer, targetUserId, roomId }) => {
        console.log(`📥 WebRTC Answer from ${socket.id} to ${targetUserId} in room ${roomId}`);
        
        const targetSocket = findSocketByUserId(io, targetUserId);
        
        if (targetSocket) {
            targetSocket.emit("webrtc:answer", {
                answer,
                fromUserId: getSocketUserId(io, socket.id),
                fromSocketId: socket.id
            });
            console.log(`✅ Answer forwarded to ${targetUserId}`);
        } else {
            console.log(`❌ Target user ${targetUserId} not found`);
            socket.emit("webrtc:error", { 
                message: "Target user not found" 
            });
        }
    });

    // ==========================================
    // 3️⃣ ICE CANDIDATES - Network route discovery
    // ==========================================
    socket.on("webrtc:ice-candidate", ({ candidate, targetUserId, roomId }) => {
        console.log(`🧊 ICE candidate from ${socket.id} to ${targetUserId}`);
        
        const targetSocket = findSocketByUserId(io, targetUserId);
        
        if (targetSocket) {
            targetSocket.emit("webrtc:ice-candidate", {
                candidate,
                fromUserId: getSocketUserId(io, socket.id),
                fromSocketId: socket.id
            });
        }
    });

    // ==========================================
    // 4️⃣ VIDEO TOGGLE - Notify others when camera on/off
    // ==========================================
    socket.on("webrtc:toggle-video", ({ roomId, enabled }) => {
        const userId = getSocketUserId(io, socket.id);
        console.log(`📹 User ${userId} ${enabled ? 'enabled' : 'disabled'} video`);
        
        // Broadcast to all others in the room (not to self)
        socket.to(roomId).emit("webrtc:peer-video-toggle", {
            userId,
            enabled
        });
    });

    // ==========================================
    // 5️⃣ AUDIO TOGGLE - Notify others when mic on/off
    // ==========================================
    socket.on("webrtc:toggle-audio", ({ roomId, enabled }) => {
        const userId = getSocketUserId(io, socket.id);
        console.log(`🎤 User ${userId} ${enabled ? 'unmuted' : 'muted'} audio`);
        
        // Broadcast to all others in the room (not to self)
        socket.to(roomId).emit("webrtc:peer-audio-toggle", {
            userId,
            enabled
        });
    });

    console.log(`✅ WebRTC handlers registered for socket ${socket.id}`);
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Find a socket by userId
 * Uses the socketUserMap we created in server.js
 */
function findSocketByUserId(io, userId) {
    for (const [socketId, data] of io.socketUserMap.entries()) {
        if (data.userId === userId) {
            return io.sockets.sockets.get(socketId);
        }
    }
    return null;
}

/**
 * Get userId from socket ID
 */
function getSocketUserId(io, socketId) {
    const data = io.socketUserMap.get(socketId);
    return data ? data.userId : null;
}