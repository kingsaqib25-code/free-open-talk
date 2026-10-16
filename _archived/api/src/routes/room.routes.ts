import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { roomCreationRateLimiter } from '../middleware/rate-limiter.middleware.js';
import {
    listRooms,
    getRoom,
    getRoomParticipants,
    createRoom,
    updateRoom,
    joinRoom,
    leaveRoom,
    closeRoom,
    kickUser,
    transferOwnership,
    getUserOwnedRooms,
    getUserCurrentRoom,
} from '../controllers/room.controller.js';

export const roomRouter = Router();

// ------------------- User-specific Routes

// GET /rooms/user/owned - Get rooms owned by the current user
roomRouter.get('/user/owned', authMiddleware, getUserOwnedRooms);

// GET /rooms/user/current - Get current room the user is in
roomRouter.get('/user/current', authMiddleware, getUserCurrentRoom);

// -------------------- Public Routes 

// GET /rooms - List all active rooms (public, with pagination)
roomRouter.get('/', listRooms);

// GET /rooms/:id - Get room details by ID or slug (public)
roomRouter.get('/:id', getRoom);

// GET /rooms/:id/participants - Get all participants in a room (public)
roomRouter.get('/:id/participants', getRoomParticipants);

// ---------------------- Protected Routes 

// POST /rooms - Create a new room (requires auth)
roomRouter.post('/', authMiddleware, roomCreationRateLimiter, createRoom);

// PUT /rooms/:id - Update room details (owner only)
roomRouter.put('/:id', authMiddleware, updateRoom);

// POST /rooms/:id/join - Join a room (requires auth)
roomRouter.post('/:id/join', authMiddleware, joinRoom);

// POST /rooms/:id/leave - Leave a room (requires auth)
roomRouter.post('/:id/leave', authMiddleware, leaveRoom);

// DELETE /rooms/:id - Close a room (owner only)
roomRouter.delete('/:id', authMiddleware, closeRoom);

// POST /rooms/:id/kick/:userId - Kick a user from the room (owner only)
roomRouter.post('/:id/kick/:userId', authMiddleware, kickUser);

// POST /rooms/:id/transfer/:userId - Transfer room ownership (owner only)
roomRouter.post('/:id/transfer/:userId', authMiddleware, transferOwnership);
