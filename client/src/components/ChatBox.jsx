import React, { useState, useEffect, useRef } from "react";
import { socket } from "../socket.js";

const ChatBox = ({ roomId, user }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const chatEndRef = useRef(null);

  // 🔄 Auto-scroll chat to bottom
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    // 📥 Listen for incoming messages
    socket.on("new-message", (messageData) => {
      console.log("📩 New message received:", messageData);
      setMessages((prev) => [...prev, messageData]);
    });

    return () => {
      socket.off("new-message");
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // ✉️ Send a message
 const handleSendMessage = () => {
    if (!input.trim()) return;

    const messageData = {
        roomId,
        userId: (user._id || user.id).toString(),
        username: user.username,
        text: input.trim(),
    };

    console.log("📤 Sending message:", messageData);
    socket.emit("send-message", messageData);

    setInput("");
};


  // 🖱️ Handle Enter key press
  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  return (
    <div
      style={{
        width: "350px",
        height: "400px",
        border: "1px solid #ccc",
        borderRadius: "10px",
        marginTop: "20px",
        marginLeft: "auto",
        marginRight: "auto",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#fafafa",
      }}
    >
      {/* 💬 Header */}
      <div
        style={{
          backgroundColor: "#4CAF50",
          color: "white",
          padding: "10px",
          textAlign: "center",
          borderTopLeftRadius: "10px",
          borderTopRightRadius: "10px",
        }}
      >
        <strong>💬 Meeting Chat</strong>
      </div>

      {/* 🧾 Message List */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {messages.length === 0 ? (
          <p style={{ textAlign: "center", color: "#777" }}>
            No messages yet...
          </p>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              style={{
                alignSelf:
                  msg.userId === (user._id || user.id)
                    ? "flex-end"
                    : "flex-start",
                backgroundColor:
                  msg.userId === (user._id || user.id)
                    ? "#DCF8C6"
                    : "#FFFFFF",
                borderRadius: "8px",
                padding: "8px 12px",
                maxWidth: "80%",
                boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
              }}
            >
              <strong style={{ fontSize: "13px", color: "#333" }}>
                {msg.username}
              </strong>
              <p style={{ margin: "4px 0", fontSize: "14px" }}>{msg.text}</p>
              <span style={{ fontSize: "10px", color: "#999" }}>
                {new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))
        )}
        <div ref={chatEndRef}></div>
      </div>

      {/* 🧑‍💻 Input Box */}
      <div
        style={{
          display: "flex",
          padding: "10px",
          borderTop: "1px solid #ccc",
          backgroundColor: "#f5f5f5",
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
            padding: "8px",
            borderRadius: "5px",
            border: "1px solid #ccc",
          }}
        />
        <button
          onClick={handleSendMessage}
          style={{
            marginLeft: "8px",
            padding: "8px 14px",
            backgroundColor: "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatBox;
