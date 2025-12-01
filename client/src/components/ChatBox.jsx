import React, { useState, useEffect, useRef } from "react";
import { socket } from "../socket.js";

const ChatBox = ({ roomId, user, messages }) => {
  const [input, setInput] = useState("");
  const chatEndRef = useRef(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    socket.on("chat:message", (messageData) => {
      console.log("📩 New message received:", messageData);
    });

    return () => {
      socket.off("new-message");
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (!input.trim()) return;

    const messageData = {
      roomId,
      userId: (user._id || user.id).toString(),
      username: user.username,
      text: input.trim(),
    };

    console.log("📤 Sending message:", messageData);
    socket.emit("chat:message", messageData);

    setInput("");
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#0f0f0f",
        borderRadius: "12px",
        overflow: "hidden",
        border: "1px solid #1c1c1c",
        boxShadow: "0 0 15px rgba(0,0,0,0.5)",
      }}
    >
      {/* HEADER */}
      <div
        style={{
          padding: "12px",
          background: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(6px)",
          color: "white",
          textAlign: "center",
          fontWeight: 600,
          fontSize: "16px",
          borderBottom: "1px solid #222",
        }}
      >
        💬 Chat
      </div>

      {/* MESSAGE LIST */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          background: "#0d0d0d",
        }}
      >
        {messages.length === 0 ? (
          <p style={{ textAlign: "center", color: "#555" }}>No messages yet...</p>
        ) : (
          messages.map((msg, index) => {
            const isMe = msg.userId === (user._id || user.id);

            return (
              <div
                key={index}
                style={{
                  alignSelf: isMe ? "flex-end" : "flex-start",
                  background: isMe ? "#1f4cff" : "#1c1c1c",
                  color: "white",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  maxWidth: "80%",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                }}
              >
                <strong
                  style={{
                    fontSize: "12px",
                    opacity: 0.8,
                    display: "block",
                    marginBottom: "4px",
                  }}
                >
                  {msg.username}
                </strong>

                <span style={{ fontSize: "14px" }}>{msg.text}</span>
              </div>
            );
          })
        )}

        <div ref={chatEndRef}></div>
      </div>

      {/* INPUT AREA */}
      <div
        style={{
          padding: "10px",
          background: "#111",
          borderTop: "1px solid #222",
          display: "flex",
          gap: "8px",
        }}
      >
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyPress}
          style={{
            flex: 1,
            padding: "10px",
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: "8px",
            color: "white",
            outline: "none",
          }}
        />

        <button
          onClick={handleSendMessage}
          style={{
            padding: "10px 16px",
            background: "#1f4cff",
            border: "none",
            color: "white",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: 500,
            transition: "0.2s",
          }}
          onMouseOver={(e) => (e.target.style.opacity = "0.9")}
          onMouseOut={(e) => (e.target.style.opacity = "1")}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatBox;
