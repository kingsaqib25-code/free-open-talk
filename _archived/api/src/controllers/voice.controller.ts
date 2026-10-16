import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/app-error.js';
import * as voiceService from '../services/voice.service.js';
import type { RtpCapabilities, DtlsParameters, RtpParameters } from 'mediasoup/types';
import { z } from 'zod';

// Validation schemas
const createTransportSchema = z.object({
    roomId: z.string().uuid(),
    direction: z.enum(['send', 'recv']),
});

const connectTransportSchema = z.object({
    roomId: z.string().uuid(),
    transportId: z.string(),
    dtlsParameters: z.any(),
});

const produceSchema = z.object({
    roomId: z.string().uuid(),
    transportId: z.string(),
    kind: z.enum(['audio', 'video']),
    rtpParameters: z.any(),
});

const consumeSchema = z.object({
    roomId: z.string().uuid(),
    producerId: z.string(),
    rtpCapabilities: z.any(),
});


// GET /voice/rtp-capabilities/:roomId
// Get RTP capabilities for a room's router
export async function getRtpCapabilities(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId } = req.params;

        if (!roomId) {
            return next(new AppError('Room ID is required', 400));
        }

        const rtpCapabilities = await voiceService.getRtpCapabilities(roomId);

        res.json({
            success: true,
            data: { rtpCapabilities },
        });
    } catch (error) {
        next(error);
    }
}


// POST /voice/transport
// Create a WebRTC transport for sending or receiving media
export async function createTransport(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        const validatedData = createTransportSchema.parse(req.body);

        const transportParams = await voiceService.createTransport(
            validatedData.roomId,
            userId,
            validatedData.direction
        );

        res.json({
            success: true,
            data: transportParams,
        });
    } catch (error) {
        next(error);
    }
}


// POST /voice/connect-transport
// Connect a transport with DTLS parameters
export async function connectTransport(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        const validatedData = connectTransportSchema.parse(req.body);

        await voiceService.connectTransport(
            validatedData.roomId,
            userId,
            validatedData.transportId,
            validatedData.dtlsParameters as DtlsParameters
        );

        res.json({
            success: true,
            message: 'Transport connected',
        });
    } catch (error) {
        next(error);
    }
}


// POST /voice/produce
// Start producing media (audio)
export async function produce(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        const validatedData = produceSchema.parse(req.body);

        const producerId = await voiceService.produce(
            validatedData.roomId,
            userId,
            validatedData.transportId,
            validatedData.rtpParameters as RtpParameters,
            validatedData.kind
        );

        res.json({
            success: true,
            data: { producerId },
        });
    } catch (error) {
        next(error);
    }
}


// POST /voice/consume
// Start consuming media from another producer
export async function consume(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        const validatedData = consumeSchema.parse(req.body);

        const consumerParams = await voiceService.consume(
            validatedData.roomId,
            userId,
            validatedData.producerId,
            validatedData.rtpCapabilities as RtpCapabilities
        );

        if (!consumerParams) {
            return next(new AppError('Cannot consume this producer', 400));
        }

        res.json({
            success: true,
            data: consumerParams,
        });
    } catch (error) {
        next(error);
    }
}


//POST /voice/pause-producer
// Pause/resume a producer (mute/unmute)
export async function pauseProducer(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        const { roomId, paused } = req.body;

        if (!roomId || typeof paused !== 'boolean') {
            return next(new AppError('Room ID and paused status are required', 400));
        }

        await voiceService.setProducerPaused(roomId, userId, paused);

        res.json({
            success: true,
            message: paused ? 'Producer paused' : 'Producer resumed',
        });
    } catch (error) {
        next(error);
    }
}

// GET /voice/producers/:roomId
// Get all active producers in a room (for a joining user to consume)
export async function getProducers(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user?.userId;
        const { roomId } = req.params;

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        if (!roomId) {
            return next(new AppError('Room ID is required', 400));
        }

        const producers = voiceService.getOtherProducers(roomId, userId);

        res.json({
            success: true,
            data: { producers },
        });
    } catch (error) {
        next(error);
    }
}
