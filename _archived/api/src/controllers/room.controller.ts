import type { Request, Response, NextFunction } from 'express';
import { createRoomSchema } from '@free2talk/shared';
import { AppError } from '../utils/app-error.js';
import * as roomService from '../services/room.service.js';
import { z } from 'zod';
import { paginationSchema, updateRoomSchema } from '../utils/validation.js';
import { getSocketInstance } from '../socket/socket-instance.js';

//  * GET /rooms
//  * List all active rooms with pagination

export async function listRooms(req: Request, res: Response, next: NextFunction) {
    try {
        const { page, limit, language } = paginationSchema.parse(req.query);

        const result = await roomService.listActiveRooms(page, limit, language);

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
}

//  * GET /rooms/:id
//  * Get room details by ID or slug

export async function getRoom(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params;

        const room = await roomService.getRoomById(id);

        res.json({
            success: true,
            data: room,
        });
    } catch (error) {
        next(error);
    }
}

//  * GET /rooms/:id/participants
//  * Get all participants in a room

export async function getRoomParticipants(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params;

        // Verify room exists
        await roomService.getRoomById(id);

        const participants = await roomService.getRoomParticipants(id);

        res.json({
            success: true,
            data: participants,
        });
    } catch (error) {
        next(error);
    }
}

//  * POST /rooms
//  * Create a new room

export async function createRoom(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        // Validate input
        const validatedData = createRoomSchema.parse(req.body);

        const room = await roomService.createRoom(userId, validatedData);

        // Broadcast to hallway
        const io = getSocketInstance();
        if (io) {
            io.to('hallway').emit('hallway:room-created', {
                id: room.id,
                name: room.name,
                topic: room.topic || undefined,
                languages: room.languages || [],
                participantCount: room.participantCount,
                maxParticipants: room.maxParticipants,
                ownerId: room.ownerId,
                ownerName: room.owner.username,
            });
        }

        res.status(201).json({
            success: true,
            data: room,
            message: 'Room created successfully',
        });
    } catch (error) {
        next(error);
    }
}

//  * PUT /rooms/:id
//  * Update room details (owner only)
export async function updateRoom(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;
        const { id } = req.params;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        // Validate input
        const validatedData = updateRoomSchema.parse(req.body);

        if (Object.keys(validatedData).length === 0) {
            return next(new AppError('No valid update fields provided', 400));
        }

        const room = await roomService.updateRoom(id, userId, validatedData);

        // Broadcast to hallway
        const io = getSocketInstance();
        if (io) {
            io.to('hallway').emit('hallway:room-updated', {
                id: room.id,
                name: room.name,
                topic: room.topic || undefined,
                languages: room.languages || [],
                participantCount: room.participantCount,
                maxParticipants: room.maxParticipants,
                ownerId: room.ownerId,
                ownerName: room.owner.username,
            });
        }

        res.json({
            success: true,
            data: room,
            message: 'Room updated successfully',
        });
    } catch (error) {
        next(error);
    }
}

//  * POST /rooms/:id/join
//  * Join a room
export async function joinRoom(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;
        const { id } = req.params;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        const result = await roomService.joinRoom(id, userId);

        // Broadcast updated participant count to hallway
        const io = getSocketInstance();
        if (io) {
            io.to('hallway').emit('hallway:room-updated', {
                id: result.room.id,
                name: result.room.name,
                topic: result.room.topic || undefined,
                languages: result.room.languages || [],
                participantCount: result.room.participantCount,
                maxParticipants: result.room.maxParticipants,
                ownerId: result.room.ownerId,
                ownerName: result.room.owner.username,
            });
        }

        res.json({
            success: true,
            data: result,
            message: 'Joined room successfully',
        });
    } catch (error) {
        next(error);
    }
}


//  * POST /rooms/:id/leave
//  * Leave a room

export async function leaveRoom(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;
        const { id } = req.params;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        await roomService.leaveRoom(id, userId);

        res.json({
            success: true,
            message: 'Left room successfully',
        });
    } catch (error) {
        next(error);
    }
}

//  * DELETE /rooms/:id
//  * Close a room (owner only)

export async function closeRoom(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;
        const { id } = req.params;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        await roomService.closeRoom(id, userId);

        // Broadcast room closed to hallway
        const io = getSocketInstance();
        if (io) {
            io.to('hallway').emit('hallway:room-closed', id);
            io.to(`room:${id}`).emit('room:closed', 'Room closed by owner');
        }

        res.json({
            success: true,
            message: 'Room closed successfully',
        });
    } catch (error) {
        next(error);
    }
}

//  * POST /rooms/:id/kick/:userId
//  * Kick a user from a room (owner only)

export async function kickUser(req: Request, res: Response, next: NextFunction) {
    try {
        const ownerId = req.user?.userId;
        const { id: roomId, userId: targetUserId } = req.params;

        if (!ownerId) {
            return next(new AppError('Authentication required', 401));
        }

        await roomService.kickUser(roomId, ownerId, targetUserId);

        // Broadcast kick event
        const io = getSocketInstance();
        if (io) {
            io.to(`room:${roomId}`).emit('room:user-kicked', targetUserId);
        }

        res.json({
            success: true,
            message: 'User kicked successfully',
        });
    } catch (error) {
        next(error);
    }
}

//  * POST /rooms/:id/transfer/:userId
//  * Transfer room ownership (owner only)

export async function transferOwnership(req: Request, res: Response, next: NextFunction) {
    try {
        const currentOwnerId = req.user?.userId;
        const { id: roomId, userId: newOwnerId } = req.params;

        if (!currentOwnerId) {
            return next(new AppError('Authentication required', 401));
        }

        const result = await roomService.transferOwnership(roomId, currentOwnerId, newOwnerId);

        // Broadcast ownership change with full participant updates
        const io = getSocketInstance();
        if (io) {
            console.log(`[Controller] Broadcasting ownership change for room ${roomId}`);

            // Emit owner-changed event
            io.to(`room:${roomId}`).emit('room:owner-changed', newOwnerId);

            // Also broadcast updated participant list for full UI sync
            const participants = await roomService.getRoomParticipants(roomId);
            const participantList = participants.map(p => ({
                id: p.id,
                userId: p.userId || p.oderId,
                oderId: p.userId || p.oderId,
                username: p.username,
                displayName: p.displayName || undefined,
                avatarUrl: p.avatarUrl || undefined,
                role: p.role,
                isMuted: true,
                isSpeaking: false,
                joinedAt: p.joinedAt,
            }));

            (io.to(`room:${roomId}`) as any).emit('room:participants-updated', {
                participants: participantList,
                reason: 'ownership-transferred',
            });

            console.log(`[Controller] Ownership transfer broadcast complete - New owner: ${newOwnerId}`);
        }

        res.json({
            success: true,
            message: 'Ownership transferred successfully',
            data: result,
        });
    } catch (error) {
        next(error);
    }
}

//  * GET /rooms/user/owned
//  * Get rooms owned by the current user

export async function getUserOwnedRooms(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        const rooms = await roomService.getUserRooms(userId);

        res.json({
            success: true,
            data: rooms,
        });
    } catch (error) {
        next(error);
    }
}

//  * GET /rooms/user/current
//  * Get the current room the user is in

export async function getUserCurrentRoom(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        const room = await roomService.getUserCurrentRoom(userId);

        res.json({
            success: true,
            data: room,
        });
    } catch (error) {
        next(error);
    }
}
