import express from "express";
import { createMeeting,joinMeeting,getMeetingDetails } from "../controllers/meetingController.js";
import auth from "../middlewares/auth.js";

const router=express.Router();


router.post('/create',auth,createMeeting);
router.post('/join/:roomId',auth,joinMeeting);
router.get('/:roomId',auth,getMeetingDetails);

export default router;