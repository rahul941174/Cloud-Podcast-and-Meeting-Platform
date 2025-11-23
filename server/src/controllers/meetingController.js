import Meeting from "../models/Meeting.js";
import { v4 as uuidv4 } from "uuid";
import User from "../models/User.js";

// CREATE MEETING
export const createMeeting = async (req, res) => {
    try {
        const { title, metaData } = req.body;
        const userId = req.user.id;

        const host = await User.findById(userId);
        if (!host) {
            return res.status(404).json({
                message: 'Host user not found'
            });
        }

        const roomId = uuidv4();

        // DON'T add host to participants here
        // Let socket handle it when they join
        const meeting = new Meeting({
            roomId,
            title: title || `${host.username}'s Meeting`,
            host: userId,
            metaData: metaData || {},
            participants: [], // Empty initially
            isActive: true
        });

        await meeting.save();

        res.status(201).json({
            meeting,
            message: 'Meeting created successfully'
        });

    } catch (error) {
        res.status(500).json({
            message: 'Error in creating meeting',
            error: error.message
        });
    }
};

// JOIN MEETING
export const joinMeeting = async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.user.id;

        if (!roomId) {
            return res.status(400).json({
                message: 'roomId is required to join meeting'
            });
        }

        const meeting = await Meeting.findOne({ roomId });
        if (!meeting) {
            return res.status(404).json({
                message: 'Meeting not found with such roomId'
            });
        }

        if (meeting.isActive === false) {
            return res.status(410).json({
                message: 'This meeting has ended and cannot be joined.'
            });
        }

        //  DON'T add participant here - let socket handle it
        // Just verify the meeting is valid
        const isAlreadyParticipant = meeting.participants.some(
            p => p.user.toString() === userId
        );

        res.status(200).json({
            message: isAlreadyParticipant 
                ? "Already in meeting" 
                : "Meeting is active, ready to join",
            meeting: {
                roomId: meeting.roomId,
                title: meeting.title,
                participantsCount: meeting.participants.length,
                isActive: meeting.isActive
            },
        });

    } catch (error) {
        res.status(500).json({
            message: 'Error in joining meeting',
            error: error.message
        });
    }
};

// GET MEETING DETAILS
export const getMeetingDetails = async (req, res) => {
    try {
        const { roomId } = req.params;

        if (!roomId) {
            return res.status(400).json({
                message: 'roomId is required to fetch meeting details'
            });
        }

        const meeting = await Meeting.findOne({ roomId })
            .populate("participants.user", "username email")
            .populate("host", "username email");

        if (!meeting) {
            return res.status(404).json({
                message: 'Meeting not found with such roomId'
            });
        }

        res.status(200).json({
            meeting,
            message: 'Meeting details fetched successfully'
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error in fetching meeting details',
            error: error.message
        });
    }
};


export const endMeeting=async(req,res)=>{
    try{

        const { roomId } = req.params;

        if (!roomId) {
            return res.status(400).json({
                message: 'roomId is required to fetch meeting details'
            });
        }

        const meeting = await Meeting.findOne({ roomId });
        if (!meeting) {
            return res.status(404).json({
                message: 'Meeting not found with such roomId'
            });
        }

        meeting.isActive=false;

        await meeting.save();

        res.status(200).json({
            message: 'Meeting acive set false successfully'
        });


    }
    catch(error){
        res.status(500).json({
            message: 'Error in ending meeting',
            error: error.message
        });
    }   
};