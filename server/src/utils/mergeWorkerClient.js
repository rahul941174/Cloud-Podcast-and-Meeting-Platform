// server/src/utils/mergeWorkerClient.js
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.MERGE_WORKER_URL;

if (!BASE_URL) {
  console.warn("⚠️ MERGE_WORKER_URL is not set in .env — merge-worker calls will fail.");
}

/**
 * requestMerge(roomId)
 * - Calls the external merge-worker to request processing for a room.
 * - The merge-worker server (merge-worker/server.js) expects POST /merge with body { roomId }.
 * - Returns the parsed response data on success, throws a descriptive Error on failure.
 */
export async function requestMerge(roomId, opts = {}) {
  if (!BASE_URL) {
    throw new Error("MERGE_WORKER_URL not configured in server environment");
  }

  if (!roomId) {
    throw new Error("roomId is required for requestMerge");
  }

  const url = `${BASE_URL.replace(/\/+$/, "")}/merge`; // ensure no trailing slash problems
  console.log(`📡 Sending merge request to: ${url} (roomId=${roomId})`);

  try {
    const response = await axios.post(
      url,
      { roomId },
      {
        timeout: opts.timeout || 120000, // 2 minutes default (tunable)
      }
    );

    // Accept 2xx success responses; otherwise throw
    if (response && response.data) {
      console.log("✅ Merge-worker response:", response.data);
      return response.data;
    }

    throw new Error("Merge-worker returned empty response");
  } catch (err) {
    // Bubble up helpful error message with as much context as possible
    const msg = err.response?.data?.error || err.response?.data?.message || err.message;
    console.error("❌ Merge-worker error:", msg);
    throw new Error(`Merge worker request failed: ${msg}`);
  }
}

export default {
  requestMerge,
};
