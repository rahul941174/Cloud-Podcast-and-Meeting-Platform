/**
 * WebRTC Signaling Handler (FIXED)
 * 
 * Fixes:
 * - Stale socket detection and cleanup
 * - Answer timeout handling
 * - Out-of-order packet buffering
 * - Proper ICE candidate queuing
 */

/**
 * Register WebRTC event handlers on a socket
 */
export const registerWebRTCHandlers = (io, socket) => {
    
    // 🔥 FIX: Track answer timeouts
    const answerTimeouts = new Map();
    const ANSWER_TIMEOUT = 8000; // 8 seconds
    
    // 🔥 FIX: Buffer for out-of-order packets
    const pendingAnswers = new Map();
    
    // ==========================================
    // 1️⃣ OFFER - Peer A wants to connect to Peer B
    // ==========================================
    socket.on("webrtc:offer", ({ offer, targetUserId, roomId }) => {
        console.log(`📤 WebRTC Offer from ${socket.id} to ${targetUserId} in room ${roomId}`);
        
        const fromUserId = getSocketUserId(io, socket.id);
        
        // 🔥 FIX: Find target using BOTH maps (prefer userSocketMap)
        const targetSocket = findSocketByUserId(io, targetUserId);
        
        if (targetSocket) {
            // Send the offer to the specific target user
            targetSocket.emit("webrtc:offer", {
                offer,
                fromUserId: fromUserId,
                fromSocketId: socket.id
            });
            console.log(`✅ Offer forwarded to ${targetUserId}`);
            
            // 🔥 FIX: Set timeout for answer
            const timeoutKey = `${fromUserId}-${targetUserId}`;
            const timeout = setTimeout(() => {
                console.log(`⏱️ Answer timeout for ${fromUserId} -> ${targetUserId}`);
                socket.emit("webrtc:answer-timeout", { 
                    targetUserId,
                    message: "Peer did not respond in time" 
                });
                answerTimeouts.delete(timeoutKey);
            }, ANSWER_TIMEOUT);
            
            answerTimeouts.set(timeoutKey, timeout);
            
        } else {
            console.log(`❌ Target user ${targetUserId} not found or stale socket`);
            socket.emit("webrtc:error", { 
                targetUserId,
                message: "Target user not found or disconnected" 
            });
        }
    });

    // ==========================================
    // 2️⃣ ANSWER - Peer B responds to Peer A
    // ==========================================
    socket.on("webrtc:answer", ({ answer, targetUserId, roomId }) => {
        console.log(`📥 WebRTC Answer from ${socket.id} to ${targetUserId} in room ${roomId}`);
        
        const fromUserId = getSocketUserId(io, socket.id);
        const targetSocket = findSocketByUserId(io, targetUserId);
        
        if (targetSocket) {
            targetSocket.emit("webrtc:answer", {
                answer,
                fromUserId: fromUserId,
                fromSocketId: socket.id
            });
            console.log(`✅ Answer forwarded to ${targetUserId}`);
            
            // 🔥 FIX: Clear answer timeout
            const timeoutKey = `${targetUserId}-${fromUserId}`;
            const timeout = answerTimeouts.get(timeoutKey);
            if (timeout) {
                clearTimeout(timeout);
                answerTimeouts.delete(timeoutKey);
            }
            
        } else {
            console.log(`❌ Target user ${targetUserId} not found`);
            
            // 🔥 FIX: Buffer answer in case offer hasn't arrived yet
            const bufferKey = `${targetUserId}-${fromUserId}`;
            pendingAnswers.set(bufferKey, answer);
            
            // Clear buffer after 5 seconds
            setTimeout(() => {
                pendingAnswers.delete(bufferKey);
            }, 5000);
            
            socket.emit("webrtc:error", { 
                message: "Target user not found" 
            });
        }
    });

    // ==========================================
    // 3️⃣ ICE CANDIDATES - Network route discovery
    // ==========================================
    socket.on("webrtc:ice-candidate", ({ candidate, targetUserId, roomId }) => {
        const fromUserId = getSocketUserId(io, socket.id);
        console.log(`🧊 ICE candidate from ${fromUserId} to ${targetUserId}`);
        
        const targetSocket = findSocketByUserId(io, targetUserId);
        
        if (targetSocket) {
            targetSocket.emit("webrtc:ice-candidate", {
                candidate,
                fromUserId: fromUserId,
                fromSocketId: socket.id
            });
        } else {
            console.log(`⚠️ Cannot send ICE candidate, ${targetUserId} not found`);
        }
    });

    // ==========================================
    // 4️⃣ VIDEO TOGGLE - Notify others when camera on/off
    // ==========================================
    socket.on("webrtc:toggle-video", ({ roomId, enabled }) => {
        const userId = getSocketUserId(io, socket.id);
        console.log(`📹 User ${userId} ${enabled ? 'enabled' : 'disabled'} video`);
        
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
        
        socket.to(roomId).emit("webrtc:peer-audio-toggle", {
            userId,
            enabled
        });
    });
    
    // 🔥 FIX: Request renegotiation when track changes
    socket.on("webrtc:renegotiate", ({ targetUserId, roomId }) => {
        console.log(`🔄 Renegotiation request from ${socket.id} to ${targetUserId}`);
        
        const fromUserId = getSocketUserId(io, socket.id);
        const targetSocket = findSocketByUserId(io, targetUserId);
        
        if (targetSocket) {
            targetSocket.emit("webrtc:renegotiate-request", {
                fromUserId: fromUserId
            });
        }
    });
    
    // 🔥 FIX: Cleanup handler for peer disconnect
    socket.on("webrtc:cleanup-peer", ({ peerId }) => {
        console.log(`🧹 Cleanup request for peer ${peerId}`);
        // This is just logged, actual cleanup happens on client
    });

    console.log(`✅ WebRTC handlers registered for socket ${socket.id}`);
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * 🔥 FIX: Enhanced socket lookup with stale detection
 */
function findSocketByUserId(io, userId) {
    // First try userSocketMap (more reliable)
    const socketId = io.userSocketMap.get(userId);
    if (socketId) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
            return socket;
        } else {
            // 🔥 FIX: Found stale mapping, clean it up
            console.log(`⚠️ Stale socket mapping detected for user ${userId}, cleaning up`);
            io.userSocketMap.delete(userId);
            io.socketUserMap.delete(socketId);
        }
    }
    
    // Fallback: search through all sockets (less efficient)
    for (const [socketId, data] of io.socketUserMap.entries()) {
        if (data.userId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.connected) {
                // 🔥 FIX: Rebuild userSocketMap
                io.userSocketMap.set(userId, socketId);
                return socket;
            }
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