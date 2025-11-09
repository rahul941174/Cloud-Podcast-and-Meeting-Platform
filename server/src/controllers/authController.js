import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const COOKIE_NAME = process.env.COOKIE_NAME || 'token';

export const signup = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({
                message: 'All fields are required',
            });
        }

        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(400).json({
                message: 'User already exists'
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = new User({
            username,
            email,
            password: hashedPassword
        });

        await user.save();

        return res.status(201).json({
            message: 'User signed up successfully. Please log in.',
            user: {
                id: user._id,
                username: user.username,
                email: user.email
            }
        });

    } catch (error) {
        res.status(500).json({
            message: 'Error during signup',
            error: error.message
        });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: 'Some Fields are missing in login',
            });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({
                message: 'User does not exist. Sign up first',
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({
                message: 'Invalid password or credentials',
            });
        }

        // Generate JWT token
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        // ✅ FIX: Updated cookie settings for production cross-origin
        const isProduction = process.env.NODE_ENV === 'production';
        
        res.cookie(COOKIE_NAME, token, {
            httpOnly: true,
            secure: isProduction,  // Only HTTPS in production
            sameSite: isProduction ? 'none' : 'lax',  // ← KEY FIX: 'none' for cross-origin
            maxAge: JWT_EXPIRES_IN === '7d' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
            path: '/',
        });

        console.log('🍪 Cookie set:', {
            name: COOKIE_NAME,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
            domain: 'not set (allows cross-origin)'
        });

        return res.status(200).json({
            message: 'Login successful',
            user: {
                id: user._id,
                username: user.username,
                email: user.email
            },
            // ✅ ALSO send token in response body as backup
            token: token
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error during login',
            error: error.message
        });
    }
};

export const logout = async (req, res) => {
    try {
        const isProduction = process.env.NODE_ENV === 'production';
        
        res.clearCookie(COOKIE_NAME, {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
            path: '/',
        });

        return res.status(200).json({
            message: 'Logout successful'
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error during logout',
            error: error.message
        });
    }
};

export const me = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                message: 'Not authenticated'
            });
        }

        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        res.status(200).json({
            user,
            message: 'User data fetched successfully'
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error fetching user data',
            error: error.message
        });
    }
};