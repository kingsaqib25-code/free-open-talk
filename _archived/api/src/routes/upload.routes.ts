/**
 * Upload Routes
 * 
 * Handles file upload endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import { authMiddleware } from '../middleware/auth.middleware.js';
import * as uploadService from '../services/upload.service.js';
import * as profileService from '../services/profile.service.js';
import { AppError } from '../utils/app-error.js';

export const uploadRouter = Router();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
    },
    fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
        }
    },
});

// Upload avatar
// POST /api/v1/upload/avatar
uploadRouter.post(
    '/avatar',
    authMiddleware,
    upload.single('avatar'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user!.userId;
            const file = req.file as Express.Multer.File | undefined;

            if (!file) {
                return next(new AppError('No file uploaded', 400));
            }

            // Get current avatar URL to delete old image
            const profile = await profileService.getUserProfile(userId);
            if (profile?.avatarUrl) {
                const publicId = uploadService.extractPublicId(profile.avatarUrl);
                if (publicId) {
                    await uploadService.deleteAvatar(publicId);
                }
            }

            // Upload the avatar to Cloudinary
            const result = await uploadService.uploadAvatar(
                file.buffer,
                file.mimetype,
                userId
            );

            // Update user profile with Cloudinary secure URL
            await profileService.updateProfile(userId, { avatarUrl: result.secureUrl });

            res.json({
                success: true,
                data: {
                    avatarUrl: result.secureUrl,
                    publicId: result.publicId,
                    size: result.size,
                    format: result.format,
                },
            });
        } catch (error) {
            if (error instanceof multer.MulterError) {
                if (error.code === 'LIMIT_FILE_SIZE') {
                    return next(new AppError('File too large. Maximum size is 5MB', 400));
                }
            }
            next(error);
        }
    }
);

// Delete avatar
// DELETE /api/v1/upload/avatar
uploadRouter.delete(
    '/avatar',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user!.userId;

            // Get current avatar URL
            const profile = await profileService.getUserProfile(userId);

            if (profile?.avatarUrl) {
                // Extract public ID from Cloudinary URL
                const publicId = uploadService.extractPublicId(profile.avatarUrl);

                if (publicId) {
                    // Delete from Cloudinary
                    await uploadService.deleteAvatar(publicId);
                }
            }

            // Clear avatar URL in profile
            await profileService.updateProfile(userId, { avatarUrl: null });

            res.json({
                success: true,
                message: 'Avatar deleted successfully',
            });
        } catch (error) {
            next(error);
        }
    }
);
