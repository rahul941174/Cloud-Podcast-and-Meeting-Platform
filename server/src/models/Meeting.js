import mongoose from "mongoose";
import participantSchema from "./Participant.js";

const meetingSchema=new mongoose.Schema({
    roomId:{
        type:String,
        required:true,
        unique:true,
    },
    title:{
        type:String,
        default:''
    },
    host:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'User',
        required:true
    },
    participants:{
        type:[participantSchema],
        default:[]
    },
    isActive:{
        type:Boolean,
        default:true
    },
    createdAt:{
        type:Date,
        default:Date.now
    },
    metaData:{
        type:mongoose.Schema.Types.Mixed,   
        default:{}
    }

});

const Meeting=mongoose.model("Meeting",meetingSchema);
export default Meeting;