import React from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Welcome to Cloud Podcast & Meeting Platform 🎧</h1>
      <p>Connect. Collaborate. Communicate.</p>
      <div style={{ marginTop: 30 }}>
        <button
          onClick={() => navigate("/login")}
          style={{
            padding: "10px 20px",
            marginRight: 10,
            cursor: "pointer",
            backgroundColor: "#007bff",
            color: "#fff",
            border: "none",
            borderRadius: "5px",
          }}
        >
          Login
        </button>

        <button
          onClick={() => navigate("/signup")}
          style={{
            padding: "10px 20px",
            cursor: "pointer",
            backgroundColor: "#28a745",
            color: "#fff",
            border: "none",
            borderRadius: "5px",
          }}
        >
          Signup
        </button>
      </div>
    </div>
  );
}
