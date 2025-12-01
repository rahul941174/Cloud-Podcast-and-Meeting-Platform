// merge-worker/src/routes/mergeRoutes.js
import express from "express";
import { mergeRecording } from "../controllers/mergeController.js";

const router = express.Router();

// POST /api/merge/:roomId
router.post("/:roomId", mergeRecording);

export default router;
