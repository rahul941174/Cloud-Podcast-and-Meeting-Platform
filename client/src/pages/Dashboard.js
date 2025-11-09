import React, { useEffect, useState } from "react";
import api from "../api";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [msg, setMsg] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/auth/me")
      .then((res) => setUser(res.data.user))
      .catch(() => {
        setMsg("Not logged in");
        setTimeout(() => navigate("/login"), 1000);
      });
  }, [navigate]); 

  const handleLogout = async () => {
    await api.post("/auth/logout");
    navigate("/login");
  };

  if (!user) return <p>{msg || "Loading..."}</p>;

  return (
    <div style={{ textAlign: "center", marginTop: 50 }}>
      <h2>Welcome, {user.username}!</h2>
      <p>Email: {user.email}</p>
      <button onClick={() => navigate("/meeting")}>Go to Meetings</button>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
}
