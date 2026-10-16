import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.middleware.js';

export const userRouter = Router();


// --------------------- Authenticated Routes 

// Get current user's profile (requires auth)
userRouter.get('/me', authMiddleware, userController.getMyProfile);

// Update current user's profile
userRouter.patch('/me', authMiddleware, userController.updateMyProfile);

// Update username
userRouter.patch('/me/username', authMiddleware, userController.updateUsername);

// Get current user's activity
userRouter.get('/me/activity', authMiddleware, userController.getMyActivity);

// Get current user's rooms
userRouter.get('/me/rooms', authMiddleware, userController.getMyRooms);

// Get current user's stats
userRouter.get('/me/stats', authMiddleware, userController.getMyStats);

// --------------------- Public Routes

// Check username availability (optional auth for excluding own username)
userRouter.get('/check-username/:username', optionalAuthMiddleware, userController.checkUsername);

// Get user by username (public)
userRouter.get('/username/:username', userController.getUserByUsername);

// Get user by ID (public)
userRouter.get('/:id', userController.getUserProfile);
