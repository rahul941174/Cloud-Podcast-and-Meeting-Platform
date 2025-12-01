// server/src/controllers/meetingController.js
import Meeting from "../models/Meeting.js";
import User from "../models/User.js";
import { v4 as uuidv4 } from "uuid";

/**
 * POST /api/meetings/create
 * Create a new meeting
 */
export const createMeeting = async (req, res) => {
  try {
    const userId = req.user.id;
    const host = await User.findById(userId);

    if (!host) {
      return res.status(404).json({ message: "Host user not found" });
    }

    const roomId = uuidv4();

    const meeting = new Meeting({
      roomId,
      title: `${host.username}'s Meeting`,
      host: userId,
      isActive: true,
      participants: [], // participants pushed only when socket join-room happens
      metaData: {}
    });

    await meeting.save();

    return res.status(201).json({
      message: "Meeting created",
      meeting,
    });

  } catch (error) {
    console.error("❌ createMeeting error:", error);
    return res.status(500).json({
      message: "Error creating meeting",
      error: error.message,
    });
  }
};


/**
 * POST /api/meetings/join/:roomId
 * Validate meeting BEFORE socket joins it
 */
export const joinMeeting = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    if (!roomId) {
      return res.status(400).json({ message: "roomId required" });
    }

    const meeting = await Meeting.findOne({ roomId });

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    if (!meeting.isActive) {
      return res.status(410).json({ message: "Meeting has ended" });
    }

    const alreadyInMeeting = meeting.participants.some(
      (p) => p.user.toString() === userId
    );

    return res.status(200).json({
      message: alreadyInMeeting ? "Already in meeting" : "Ready to join",
      meeting: {
        roomId: meeting.roomId,
        title: meeting.title,
        host: meeting.host,
        participantsCount: meeting.participants.length,
        isActive: meeting.isActive,
      },
    });

  } catch (error) {
    console.error("❌ joinMeeting error:", error);
    return res.status(500).json({
      message: "Error joining meeting",
      error: error.message,
    });
  }
};


/**
 * GET /api/meetings/:roomId
 * Fetch meeting details
 */
export const getMeetingDetails = async (req, res) => {
  try {
    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({ message: "roomId required" });
    }

    const meeting = await Meeting.findOne({ roomId })
      .populate("host", "username email")
      .populate("participants.user", "username email");

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    return res.status(200).json({
      message: "Meeting details fetched",
      meeting,
    });

  } catch (error) {
    console.error("❌ getMeetingDetails error:", error);
    return res.status(500).json({
      message: "Error fetching meeting details",
      error: error.message,
    });
  }
};


/**
 * POST /api/meetings/end/:roomId
 * Host ends the meeting
 */
export const endMeeting = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const meeting = await Meeting.findOne({ roomId });

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    if (meeting.host.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Only host can end the meeting" });
    }

    meeting.isActive = false;
    meeting.participants = [];
    await meeting.save();

    return res.status(200).json({
      message: "Meeting ended successfully",
      roomId,
    });

  } catch (error) {
    console.error("❌ endMeeting error:", error);
    return res.status(500).json({
      message: "Error ending meeting",
      error: error.message,
    });
  }
};

export default {
  createMeeting,
  joinMeeting,
  getMeetingDetails,
  endMeeting,
};
