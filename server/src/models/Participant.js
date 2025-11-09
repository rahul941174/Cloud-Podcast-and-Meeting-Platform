import mongoose from "mongoose";
import User from "./User.js";

const participantSchema=new mongoose.Schema({
    user:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'User',
        required:true
    },
    joinedAt:{
        type:Date,
        default:Date.now
    },
    role:{
        type:String,
        enum:['host','participant'],
        default:'participant'
    },
},{_id: false });

export default participantSchema;