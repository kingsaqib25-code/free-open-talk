import { Request, Response, NextFunction } from 'express';
import * as profileService from '../services/profile.service.js';
import { AppError } from '../utils/app-error.js';


// Get current user's full profile
// GET /api/v1/users/me
export async function getMyProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;

        const [profile, stats] = await Promise.all([
            profileService.getUserProfile(userId),
            profileService.getUserStats(userId),
        ]);

        if (!profile) {
            return next(new AppError('Profile not found', 404));
        }

        res.json({
            success: true,
            data: {
                profile,
                stats,
            },
        });
    } catch (error) {
        next(error);
    }
}


// Update current user's profile
// PATCH /api/v1/users/me
export async function updateMyProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const { displayName, bio, avatarUrl, nativeLanguages, learningLanguages } = req.body;

        const updated = await profileService.updateProfile(userId, {
            displayName,
            bio,
            avatarUrl,
            nativeLanguages,
            learningLanguages,
        });

        if (!updated) {
            return next(new AppError('Failed to update profile', 500));
        }

        res.json({
            success: true,
            data: { user: updated },
        });
    } catch (error) {
        next(error);
    }
}

// Update username
// PATCH /api/v1/users/me/username
export async function updateUsername(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const { username } = req.body;

        if (!username || typeof username !== 'string') {
            return next(new AppError('Username is required', 400));
        }

        await profileService.updateUsername(userId, username);

        res.json({
            success: true,
            message: 'Username updated successfully',
        });
    } catch (error) {
        if (error instanceof Error) {
            return next(new AppError(error.message, 400));
        }
        next(error);
    }
}


// Check username availability
// GET /api/v1/users/check-username/:username
export async function checkUsername(req: Request, res: Response, next: NextFunction) {
    try {
        const { username } = req.params;
        const userId = req.user?.userId;

        const available = await profileService.isUsernameAvailable(username, userId);

        res.json({
            success: true,
            data: { available },
        });
    } catch (error) {
        next(error);
    }
}


// Get user's activity feed
// GET /api/v1/users/me/activity
export async function getMyActivity(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

        const activity = await profileService.getUserActivity(userId, limit);

        res.json({
            success: true,
            data: activity,
        });
    } catch (error) {
        next(error);
    }
}


// Get user's created rooms
// GET /api/v1/users/me/rooms
export async function getMyRooms(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

        const rooms = await profileService.getUserRooms(userId, limit);

        res.json({
            success: true,
            data: rooms,
        });
    } catch (error) {
        next(error);
    }
}

// Get user's statistics
// GET /api/v1/users/me/stats 
export async function getMyStats(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const stats = await profileService.getUserStats(userId);

        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
}

// --------------- Public Profile Endpoints


// Get public profile by ID
// GET /api/v1/users/:id
export async function getUserProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params;

        const profile = await profileService.getUserProfile(id);

        if (!profile) {
            return next(new AppError('User not found', 404));
        }

        res.json({
            success: true,
            data: profile,
        });
    } catch (error) {
        next(error);
    }
}


// Get public profile by username
// GET /api/v1/users/username/:username
export async function getUserByUsername(req: Request, res: Response, next: NextFunction) {
    try {
        const { username } = req.params;

        const profile = await profileService.getUserByUsername(username);

        if (!profile) {
            return next(new AppError('User not found', 404));
        }

        // get stats for public profile
        const stats = await profileService.getUserStats(profile.id);

        res.json({
            success: true,
            data: {
                profile,
                stats,
            },
        });
    } catch (error) {
        next(error);
    }
}
