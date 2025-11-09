import { io } from "socket.io-client";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";

console.log("🔌 Initializing socket connection to:", BACKEND_URL);

export const socket = io(BACKEND_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10,
    transports: ['websocket', 'polling'],
    withCredentials: true,
    forceNew: true,
    path: '/socket.io', // Explicitly set the path
});

// Debug logs
socket.on("connect", () => {
    console.log("✅ Socket.io CONNECTED successfully!");
    console.log("Socket ID:", socket.id);
    console.log("Transport:", socket.io.engine.transport.name);
});

socket.on("disconnect", (reason) => {
    console.log("🔴 Socket.io DISCONNECTED:", reason);
    if (reason === "io server disconnect") {
        console.log("Server disconnected. Attempting reconnection...");
        socket.connect();
    }
});

socket.on("connect_error", (error) => {
    console.error("❌ Socket.io CONNECTION ERROR:", error.message);
    console.error("Full error:", error);
});

socket.on("reconnect_attempt", (attemptNumber) => {
    console.log(`🔄 Reconnection attempt #${attemptNumber}`);
});

socket.on("reconnect", (attemptNumber) => {
    console.log(`✅ Reconnected after ${attemptNumber} attempts`);
});

socket.on("reconnect_error", (error) => {
    console.error("❌ Reconnection error:", error.message);
});

socket.on("reconnect_failed", () => {
    console.error("❌ Reconnection failed after all attempts");
});

export default socket;