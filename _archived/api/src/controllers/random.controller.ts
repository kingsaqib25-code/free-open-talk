import { Request, Response, NextFunction } from 'express';
import * as randomService from '../services/random.service.js';
import * as randomAnalytics from '../services/random-analytics.service.js';
import { AppError } from '../utils/app-error.js';

// Get current random call statistics
// GET /api/random/stats
export async function getStats(req: Request, res: Response, next: NextFunction) {
    try {
        const stats = await randomService.getStats();
        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
}


// Get user's call preferences
// GET /api/random/preferences
export async function getPreferences(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const prefs = await randomAnalytics.getUserCallStats(userId);

        res.json({
            success: true,
            data: prefs,
        });
    } catch (error) {
        next(error);
    }
}


// Update user's call preferences
// PUT /api/random/preferences
export async function updatePreferences(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const { preferredLanguages, languagePreferenceEnabled } = req.body;

        // Validate languages array
        if (preferredLanguages && !Array.isArray(preferredLanguages)) {
            throw new AppError('preferredLanguages must be an array', 400);
        }

        if (preferredLanguages && preferredLanguages.some((l: any) => typeof l !== 'string')) {
            throw new AppError('All languages must be strings', 400);
        }

        await randomAnalytics.updateUserPreferences(userId, {
            preferredLanguages,
            languagePreferenceEnabled,
        });

        res.json({
            success: true,
            message: 'Preferences updated',
        });
    } catch (error) {
        next(error);
    }
}


// Get user's call history
// GET /api/random/history
export async function getCallHistory(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
        const offset = parseInt(req.query.offset as string) || 0;

        const history = await randomAnalytics.getUserCallHistory(userId, limit, offset);

        res.json({
            success: true,
            data: history,
        });
    } catch (error) {
        next(error);
    }
}


// Get user's personal call statistics
// GET /api/random/my-stats
export async function getMyStats(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const stats = await randomAnalytics.getUserCallStats(userId);

        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
}


// Block a user from future random matches
// POST /api/random/block/:userId
export async function blockUser(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.userId;
        const blockedUserId = req.params.userId;

        if (userId === blockedUserId) {
            throw new AppError('Cannot block yourself', 400);
        }

        await randomService.blockUser(userId, blockedUserId);

        res.json({
            success: true,
            message: 'User blocked',
        });
    } catch (error) {
        next(error);
    }
}
