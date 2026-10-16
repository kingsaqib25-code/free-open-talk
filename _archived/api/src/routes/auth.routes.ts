import { Router } from 'express';
import { getMeController, loginController, logoutController, refreshTokenController, registerController } from '../controllers/auth.controller.js';
import { googleSignIn } from '../controllers/google-auth.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { authRateLimiter } from '../middleware/rate-limiter.middleware.js';

export const authRouter = Router();


authRouter.post('/register', authRateLimiter, registerController);

authRouter.post('/login', authRateLimiter, loginController);

// Google OAuth
authRouter.post('/google', authRateLimiter, googleSignIn);

authRouter.post('/logout', authMiddleware, logoutController);
authRouter.post('/refresh', refreshTokenController);

authRouter.get('/me', authMiddleware, getMeController);
