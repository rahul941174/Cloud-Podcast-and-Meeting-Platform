import express from 'express';
import {signup,login,logout,me} from '../controllers/authController.js';
import auth from  '../middlewares/auth.js';

const router=express.Router();

router.post('/signup',signup);
router.post('/login',login);
router.post('/logout',logout);
router.get('/me',auth,me);

export default router;