// merge-worker/server.js

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { ensureDirectories, getMeetingDir } from "./src/utils/fileHelper.js";
import { processMeeting } from "./src/utils/ffmpegHelper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(cors());

const PORT = 7000;

// ----------------------------------------------
// HEALTH CHECK
// ----------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "merge-worker running", port: PORT });
});

// ----------------------------------------------
//  POST /merge
//  { roomId: "uuid" }
// ----------------------------------------------
app.post("/merge", async (req, res) => {
  try {
    const { roomId } = req.body;
    if (!roomId) return res.status(400).json({ error: "roomId is required" });

    console.log("🔧 Starting merge for room:", roomId);

    // processMeeting RETURNS THE FINAL PATH STRING
    const finalPath = await processMeeting(roomId);  

    console.log("🎉 Merge completed, final path:", finalPath);

    return res.json({
      success: true,
      finalPath,              // return the actual path
    });

  } catch (err) {
    console.error("❌ merge-worker error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});


// ----------------------------------------------
// START SERVER
// ----------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Merge Worker running at http://localhost:${PORT}`);
});
