import jwt from "jsonwebtoken"
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = process.env.COOKIE_NAME || 'token';


export default function auth(req,res,next){
    try{
        const tokenFromCookie=req.cookies?.[COOKIE_NAME];

        const authHeader = req.headers?.authorization;
        const tokenFromHeader = authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : null;

        const token=tokenFromCookie || tokenFromHeader;
        if(!token){
            return res.status(401)
            .json(
                {
                    message:'Unauthorized: No token provided'
                }
            )
        }

        const decoded=jwt.verify(token,JWT_SECRET);
        req.user={id:decoded.id};

        next();
    }
    catch(error){
        const message = error.name === 'TokenExpiredError'
            ? 'Token expired, please log in again'
            : 'Invalid token';
        return res.status(401)
        .json(
            {
                message:message,
            }
        )
    }
}