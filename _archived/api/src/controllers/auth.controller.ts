import { loginSchema, registerSchema } from '@free2talk/shared';
import type { Request, Response } from 'express';
import { getUserWithProfile, loginService, logoutService, refreshTokenService, registerService } from '../services/auth.service';
import { generateTokenPair, TokenPayload, verifyRefreshToken } from '../utils/JWT';
import { AppError } from '../utils/app-error';

declare global {
    namespace Express {
        interface Request {
            user?: TokenPayload;
        }
    }
}

export async function registerController(req: Request, res: Response, next: Function) {
    try {
        // Validate input
        const validatedData = registerSchema.safeParse(req.body);

        if (!validatedData.success) {
            return next(new AppError('Invalid input: ' + JSON.stringify(validatedData.error.format()), 400));
        }

        // Register user
        const result = await registerService(validatedData.data);

        // Set refresh token in httpOnly cookie
        res.cookie('refreshToken', result.tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none', // lax for more safety but for cross-site needs none
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        // Return both tokens in response body (for mobile compatibility)
        res.status(201).json({
            success: true,
            data: {
                user: result.user,
                accessToken: result.tokens.accessToken,
                refreshToken: result.tokens.refreshToken
            }
        });
    } catch (error) {
        next(error);
    }
}

export async function loginController(req: Request, res: Response, next: Function) {
    try {
        const validation = loginSchema.safeParse(req.body);

        if (!validation.success) {
            return next(new AppError('Invalid input: ' + JSON.stringify(validation.error.format()), 400));
        }

        const result = await loginService(validation.data);

        // Set cookies
        res.cookie('refreshToken', result.tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none', // lax for more safety, but for cross-site needs 'none'
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.status(200).json({
            success: true,
            data: {
                message: 'Login successful',
                accessToken: result.tokens.accessToken,
                user: result.user,
            }
        });
    } catch (error) {
        next(error);
    }
}

export async function refreshTokenController(req: Request, res: Response, next: Function) {
    try {
        // Support both cookie and header for mobile compatibility
        const refreshToken = req.cookies.refreshToken || req.headers['x-refresh-token'] as string;

        if (!refreshToken) {
            return next(new AppError('Refresh token missing', 400));
        }

        const tokens = await refreshTokenService(refreshToken);

        // Set new refresh token in cookie (for web)
        res.cookie('refreshToken', tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none', // lax for more safety but for cross-site needs 'none'
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        // Return both tokens in response (for mobile)
        res.status(200).json({
            success: true,
            data: {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            }
        });
    } catch (error) {
        next(error);
    }
}

export async function logoutController(req: Request, res: Response, next: Function) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Unauthorized', 401));
        }

        await logoutService(userId);

        // Clear refresh token cookie
        res.clearCookie('refreshToken');

        res.status(200).json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        next(error);
    }
}

export async function getMeController(req: Request, res: Response, next: Function) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Unauthorized', 401));
        }

        // Get full user info with profile
        const user = await getUserWithProfile(userId);

        res.status(200).json({
            success: true,
            data: {
                user
            }
        });
    } catch (error) {
        console.error('[AuthController.me] Error:', error);
        next(error);
    }
}