import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import Meeting from "./pages/Meeting";

function App() {
  // const [socketId, setSocketId] = useState(null);
  // const [status, setStatus] = useState("Connecting...");

  // useEffect(() => {
  //   const socket = io("http://localhost:5000");

  //   socket.on("connect", () => {
  //     console.log("Connected to backend");
  //     setSocketId(socket.id);
  //     setStatus("Connected");
  //   });

 
  //   socket.on("disconnect", () => {
  //     console.log("Disconnected ");
  //     setStatus("Disconnected ");
  //   });


  //   return () => socket.disconnect();
  // }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/meeting" element={<Meeting />} />
      </Routes>
    </Router>
  );
}

export default App;
