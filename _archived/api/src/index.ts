import 'dotenv/config';
import { app } from './app.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initSocketHandlers } from './socket/index.js';
import { initMediasoupWorkers } from './socket/mediasoup/workers.js';
import { setSocketInstance } from './socket/socket-instance.js';
import { connectRedis, disconnectRedis } from './db/redis.js';
import { cleanupStaleRooms, cleanupAbandonedRooms } from './services/room.service.js';
import { config } from './config/env.js';

const PORT = process.env.PORT || 3001;
const ABANDONED_ROOM_CLEANUP_INTERVAL = 60 * 1000; // 1 minute
const ABANDONED_ROOM_GRACE_MINUTES = 2; // Rooms older than 2 minutes with no connections

const httpServer = createServer(app);


const io = new Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        // origin: 'http://localhost:3000',
        credentials: true,
    },
    transports: ['websocket', 'polling'],
});

let abandonedRoomCleanupInterval: NodeJS.Timeout | null = null;

// init mediasoup workers
async function start() {
    try {
        // Connect Redis
        await connectRedis();
        console.log('Redis connected');

        // Cleanup any stale rooms from previous sessions
        const cleanedRooms = await cleanupStaleRooms();
        if (cleanedRooms > 0) {
            console.log(`Cleaned up ${cleanedRooms} stale room(s)`);
        }

        await initMediasoupWorkers();
        console.log('Mediasoup workers initialized');

        // Set socket instance for global
        setSocketInstance(io);

        // Initialize socket handlers
        initSocketHandlers(io);
        console.log('✓ Socket.io handlers initialized');

        // Start periodic cleanup of abandoned rooms
        abandonedRoomCleanupInterval = setInterval(async () => {
            try {
                const closedCount = await cleanupAbandonedRooms(ABANDONED_ROOM_GRACE_MINUTES);
                if (closedCount > 0) {
                    console.log(`[Cleanup] Closed ${closedCount} abandoned room(s)`);
                }
            } catch (error) {
                console.error('[Cleanup] Error cleaning up abandoned rooms:', error);
            }
        }, ABANDONED_ROOM_CLEANUP_INTERVAL);
        console.log('✓ Abandoned room cleanup job started');

        // verify env variables
        console.log('Mediasoup announced IP process.env:', process.env.MEDIASOUP_ANNOUNCED_IP);
        console.log('Mediasoup announced IP used:', config.mediasoup.announcedIp)

        httpServer.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
async function shutdown() {
    console.log('Shutting down gracefully...');

    if (abandonedRoomCleanupInterval) {
        clearInterval(abandonedRoomCleanupInterval);
    }

    await disconnectRedis();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
