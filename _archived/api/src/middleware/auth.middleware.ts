import type { Request, Response, NextFunction } from 'express';
import { TokenPayload, verifyAccessToken } from '../utils/JWT.js';

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            user?: TokenPayload;
        }
    }
}

// Returns 401 if no valid token is provided
export const authMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Get token from Authorization header or cookies
        const authHeader = req.headers.authorization || (req.cookies ? req.cookies['accessToken'] : null);

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const token = authHeader.split(' ')[1];

        // Verify token
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const payload = verifyAccessToken(token);

        // Attach user to request
        req.user = payload;

        next();
    } catch (error) {
        console.error('Auth Middleware Error:', error);
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
};


// Optional authentication middleware
// Attaches user if valid token is provided, but doesn't require it
export const optionalAuthMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization || (req.cookies ? req.cookies['accessToken'] : null);

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            if (token) {
                try {
                    const payload = verifyAccessToken(token);
                    req.user = payload;
                } catch {
                    // Token invalid but continue without user
                }
            }
        }

        next();
    } catch (error) {
        // Continue without authentication
        next();
    }
};