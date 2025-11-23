import express from "express";
import { createMeeting,joinMeeting,getMeetingDetails, endMeeting } from "../controllers/meetingController.js";
import auth from "../middlewares/auth.js";

const router=express.Router();


router.post('/create',auth,createMeeting);
router.post('/join/:roomId',auth,joinMeeting);
router.get('/:roomId',auth,getMeetingDetails);
router.post('/end/:roomId',auth,endMeeting);

export default router;