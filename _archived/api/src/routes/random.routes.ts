import { Router } from 'express';
import * as randomController from '../controllers/random.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// Public endpoint - stats can be viewed without auth
router.get('/stats', randomController.getStats);

// Protected endpoints - require authentication
router.get('/preferences', authMiddleware, randomController.getPreferences);
router.put('/preferences', authMiddleware, randomController.updatePreferences);
router.get('/history', authMiddleware, randomController.getCallHistory);
router.get('/my-stats', authMiddleware, randomController.getMyStats);
router.post('/block/:userId', authMiddleware, randomController.blockUser);

export default router;
