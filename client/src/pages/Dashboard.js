import React, { useEffect, useState } from "react";
import api from "../api";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [msg, setMsg] = useState("Loading...");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        console.log('📡 Fetching user data...');
        const res = await api.get("/auth/me");
        console.log('✅ User data received:', res.data.user);
        setUser(res.data.user);
        setMsg("");
      } catch (err) {
        console.error('❌ Failed to fetch user:', err);
        setMsg("Not logged in. Redirecting...");
        
        // Clear token from localStorage
        localStorage.removeItem('authToken');
        
        // Redirect to login
        setTimeout(() => {
          navigate("/login");
        }, 1500);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
      
      // Clear token from localStorage
      localStorage.removeItem('authToken');
      
      console.log('✅ Logged out successfully');
      navigate("/login");
    } catch (err) {
      console.error('Logout error:', err);
      // Even if logout fails, clear local data and redirect
      localStorage.removeItem('authToken');
      navigate("/login");
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", marginTop: 50 }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ textAlign: "center", marginTop: 50 }}>
        <p>{msg}</p>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", marginTop: 50 }}>
      <h2>Welcome, {user.username}!</h2>
      <p>Email: {user.email}</p>
      <div style={{ marginTop: 20 }}>
        <button onClick={() => navigate("/meeting")} style={{ marginRight: 10 }}>
          Go to Meetings
        </button>
        <button onClick={handleLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}