import type { Request, Response, NextFunction } from 'express';
import { googleAuthService } from '../services/google-auth.service.js';
import { AppError } from '../utils/app-error.js';


// Google OAuth sign-in/sign-up controller
// Receives Google ID token or access token from frontend and returns JWT tokens

export async function googleSignIn(req: Request, res: Response, next: NextFunction) {
    try {
        const { idToken, accessToken } = req.body;

        if (!idToken && !accessToken) {
            throw new AppError('Google ID token or access token is required', 400);
        }

        const result = await googleAuthService(idToken, accessToken);

        // Set refresh token in httpOnly cookie (secure in production)
        res.cookie('refreshToken', result.tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none', // lax for more safety but for cross-site needs 'none'
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/',
        });

        res.status(200).json({
            success: true,
            message: result.isFirstTime ? 'Account created successfully' : 'Signed in successfully',
            user: result.user,
            tokens: {
                accessToken: result.tokens.accessToken,
                refreshToken: result.tokens.refreshToken,
            },
            isFirstTime: result.isFirstTime,
            needsUsername: result.needsUsername,
        });
    } catch (error) {
        next(error);
    }
}
