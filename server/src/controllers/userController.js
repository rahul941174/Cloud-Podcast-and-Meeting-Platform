import User from "../models/User.js";

export const createUser=async(req,res)=>{
    try{
        const {username,email,password}=req.body;

        const existing = await User.findOne({email});
        if(existing){
            return res.status(400).
                    json({message:"User already exists"});
        }

        const user = new User({username,email,password});
        await user.save();

        res.status(201).
        json({message:"User created successfully"});
    }
    catch(error){
        console.error("Error creating user: ", error.message);
        res.status(500).
        json({ message: "Server error", error: error.message });
    }
}

export const getAllUsers=async(req,res)=>{
    try{
        const users=await User.find();

        res.status(200)
        .json(users);
    }
    catch(error){
        console.error("Error fetching users: ", error.message);
        res.status(500).
        json({ message: "Server error", error: error.message });
    }
}