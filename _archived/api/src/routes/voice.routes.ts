import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
    getRtpCapabilities,
    createTransport,
    connectTransport,
    produce,
    consume,
    pauseProducer,
    getProducers,
} from '../controllers/voice.controller.js';

export const voiceRouter = Router();

// All voice routes require authentication
voiceRouter.use(authMiddleware);

// GET /voice/rtp-capabilities/:roomId - Get router RTP capabilities
voiceRouter.get('/rtp-capabilities/:roomId', getRtpCapabilities);

// POST /voice/transport - Create WebRTC transport (send or recv)
voiceRouter.post('/transport', createTransport);

// POST /voice/connect-transport - Connect transport with DTLS parameters
voiceRouter.post('/connect-transport', connectTransport);

// POST /voice/produce - Start producing audio
voiceRouter.post('/produce', produce);

// POST /voice/consume - Start consuming audio from another producer
voiceRouter.post('/consume', consume);

// POST /voice/pause-producer - Pause/resume producer (mute/unmute)
voiceRouter.post('/pause-producer', pauseProducer);

// GET /voice/producers/:roomId - Get all producers in a room
voiceRouter.get('/producers/:roomId', getProducers);
