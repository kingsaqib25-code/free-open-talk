/**
 * Monitoring & Health Check Routes
 * 
 * Endpoints for system monitoring, metrics collection, and health checks
 */

import { Router } from 'express';
import { metricsCollector } from '../utils/metrics.js';
import { CacheService } from '../services/cache.service.js';
import * as voiceService from '../services/voice.service.js';
import * as randomService from '../services/random.service.js';
import { getPoolStats } from '../db/index.js';

const router = Router();

/**
 * GET /health
 * 
 * Basic health check endpoint
 * Returns: { status: 'ok', timestamp }
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});

/**
 * GET /metrics
 * 
 * Prometheus-style metrics endpoint
 * Can be scraped by monitoring systems
 * 
 * Returns: Plain text in Prometheus format
 */
router.get('/metrics', async (req, res) => {
    try {
        const prometheusMetrics = metricsCollector.exportMetricsForPrometheus();

        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(prometheusMetrics);
    } catch (error) {
        console.error('[Monitoring] Error generating metrics:', error);
        res.status(500).json({ error: 'Failed to generate metrics' });
    }
});

/**
 * GET /status
 * 
 * Detailed system status and metrics
 * 
 * Returns detailed metrics including:
 * - Voice call statistics
 * - Random call statistics
 * - Database connection pool status
 * - Cache performance
 * - Memory usage
 */
router.get('/status', async (req, res) => {
    try {
        const [
            cacheStats,
            randomStats,
            poolStats,
        ] = await Promise.all([
            CacheService.getCacheStats(),
            randomService.getStats(),
            Promise.resolve(getPoolStats()),
        ]);

        const metrics = metricsCollector.getMetrics();
        const activeRooms = voiceService.getActiveRooms();
        let totalParticipants = 0;
        let totalProducers = 0;
        let totalConsumers = 0;

        for (const roomId of activeRooms) {
            const roomState = voiceService.getRoomState(roomId);
            if (roomState) {
                totalParticipants += roomState.participants.size;
                for (const participant of roomState.participants.values()) {
                    if (participant.producer) totalProducers++;
                    totalConsumers += participant.consumers.size;
                }
            }
        }

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
            },
            voice: {
                activeRooms: activeRooms.length,
                activeParticipants: totalParticipants,
                totalProducers,
                totalConsumers,
                avgRoomSize: activeRooms.length > 0
                    ? (totalParticipants / activeRooms.length).toFixed(2)
                    : '0',
            },
            random: {
                activeCalls: randomStats.activeCalls,
                usersInQueue: randomStats.inQueue,
                totalActive: randomStats.totalActive,
            },
            database: {
                poolSize: poolStats.count,
                availableConnections: poolStats.available,
                queryCount: metrics.database?.queryCount || 0,
                avgQueryTime: `${metrics.database?.avgQueryTime || 0}ms`,
                slowQueryCount: metrics.database?.slowQueryCount || 0,
            },
            cache: {
                hitRate: `${metrics.cache?.hitRate || 0}%`,
                totalEntries: cacheStats.totalEntries,
                roomCaches: cacheStats.roomCaches,
                participantCaches: cacheStats.participantCaches,
            },
        });
    } catch (error) {
        console.error('[Monitoring] Error getting status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get system status',
        });
    }
});

/**
 * GET /health/detailed
 * 
 * Detailed health check with component status
 */
router.get('/health/detailed', async (req, res) => {
    try {
        const [poolStats, randomStats] = await Promise.all([
            Promise.resolve(getPoolStats()),
            randomService.getStats(),
        ]);

        const activeRooms = voiceService.getActiveRooms();

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            components: {
                database: {
                    status: poolStats.count > 0 ? 'ok' : 'degraded',
                    poolSize: poolStats.count,
                    availableConnections: poolStats.available,
                },
                voice: {
                    status: activeRooms.length > 0 ? 'active' : 'idle',
                    activeRooms: activeRooms.length,
                },
                random: {
                    status: randomStats.totalActive > 0 ? 'active' : 'idle',
                    activeCalls: randomStats.activeCalls,
                    usersInQueue: randomStats.inQueue,
                },
                cache: {
                    status: 'ok',
                },
            },
        });
    } catch (error) {
        console.error('[Monitoring] Error in detailed health check:', error);
        res.status(500).json({
            status: 'error',
            message: 'Health check failed',
        });
    }
});

/**
 * POST /debug/log-metrics
 * 
 * Logs current metrics to console (debugging)
 * Only available in non-production
 */
router.post('/debug/log-metrics', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Not available in production' });
    }

    metricsCollector.logSummary();
    res.json({ message: 'Metrics logged to console' });
});

/**
 * POST /debug/reset-metrics
 * 
 * Resets metrics counters (debugging)
 * Only available in non-production
 */
router.post('/debug/reset-metrics', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Not available in production' });
    }

    metricsCollector.reset();
    res.json({ message: 'Metrics reset' });
});

export default router;
