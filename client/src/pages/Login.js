import React, { useState } from "react";
import api from "../api"; 
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    
    try {
      const res = await api.post("/auth/login", form);
      
      // ✅ Store token in localStorage as backup
      if (res.data.token) {
        localStorage.setItem('authToken', res.data.token);
        console.log('✅ Token stored in localStorage');
      }
      
      setMsg(res.data.message);
      
      // Navigate after short delay
      setTimeout(() => {
        navigate("/dashboard");
      }, 1000);
      
    } catch (err) {
      console.error('Login error:', err);
      setMsg(err.response?.data?.message || "Login failed");
      setLoading(false);
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: 50 }}>
      <h2>Login</h2>
      <form onSubmit={handleSubmit}>
        <input 
          name="email" 
          type="email" 
          placeholder="Email" 
          value={form.email}
          onChange={handleChange} 
          required
        /><br />
        <input 
          name="password" 
          type="password" 
          placeholder="Password" 
          value={form.password}
          onChange={handleChange} 
          required
        /><br />
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
      <p style={{ color: msg.includes('failed') ? 'red' : 'green' }}>{msg}</p>
      <p>
        Don't have an account? <a href="/signup">Sign up</a>
      </p>
    </div>
  );
}