/**
 * Application Metrics & Monitoring Service
 * 
 * Tracks performance metrics, resource usage, and call statistics
 * for monitoring, alerting, and optimization.
 * 
 * Metrics tracked:
 * - Voice call metrics (active calls, participants, latency)
 * - Database performance (query times, connection pool)
 * - Cache performance (hit rate, evictions)
 * - System resources (memory, CPU)
 * - Random call matching (queue size, match time)
 */

import { EventEmitter } from 'events';

/**
 * Metric types
 */
export interface Metric {
    name: string;
    value: number;
    timestamp: number;
    labels?: Record<string, string>;
}

export interface Metrics {
    voiceCalls: {
        activeRooms: number;
        activeParticipants: number;
        avgRoomSize: number;
        totalProducers: number;
        totalConsumers: number;
    };
    randomCalls: {
        activeCalls: number;
        inQueue: number;
        avgWaitTime: number;
        matchSuccessRate: number;
    };
    database: {
        poolSize: number;
        availableConnections: number;
        queryCount: number;
        avgQueryTime: number;
        slowQueryCount: number;
    };
    cache: {
        hitRate: number;
        missRate: number;
        evictionCount: number;
        totalEntries: number;
    };
    system: {
        memoryUsage: number;
        uptime: number;
        cpuUsage: number;
    };
}

/**
 * Metrics collector and tracker
 */
export class MetricsCollector extends EventEmitter {
    private metrics: Map<string, number[]> = new Map();
    private queryTimes: number[] = [];
    private slowQueries: number = 0;
    private startTime: number = Date.now();
    private queryCount: number = 0;
    private cacheHits: number = 0;
    private cacheMisses: number = 0;

    // Thresholds
    private readonly SLOW_QUERY_THRESHOLD = 1000; // 1 second
    private readonly MAX_METRIC_HISTORY = 300; // Keep last 5 minutes

    /**
     * Record a query execution time
     */
    recordQuery(durationMs: number, queryName: string = 'unknown'): void {
        this.queryCount++;
        this.queryTimes.push(durationMs);

        // Keep only recent history
        if (this.queryTimes.length > this.MAX_METRIC_HISTORY) {
            this.queryTimes.shift();
        }

        // Track slow queries
        if (durationMs > this.SLOW_QUERY_THRESHOLD) {
            this.slowQueries++;
            console.warn(
                `[Metrics] Slow query: ${queryName} took ${durationMs}ms`
            );
            this.emit('slow-query', { queryName, durationMs });
        }

        // Debug threshold
        if (durationMs > 100) {
            console.debug(`[Metrics] Query time: ${queryName} = ${durationMs}ms`);
        }
    }

    /**
     * Record cache hit
     */
    recordCacheHit(): void {
        this.cacheHits++;
    }

    /**
     * Record cache miss
     */
    recordCacheMiss(): void {
        this.cacheMisses++;
    }

    /**
     * Record voice metrics
     */
    recordVoiceMetrics(activeRooms: number, activeParticipants: number): void {
        this.setMetric('voice:active_rooms', activeRooms);
        this.setMetric('voice:active_participants', activeParticipants);
        this.setMetric('voice:avg_room_size',
            activeRooms > 0 ? activeParticipants / activeRooms : 0
        );
    }

    /**
     * Record random call metrics
     */
    recordRandomMetrics(
        activeCalls: number,
        inQueue: number,
        avgWaitTime: number
    ): void {
        this.setMetric('random:active_calls', activeCalls);
        this.setMetric('random:in_queue', inQueue);
        this.setMetric('random:avg_wait_time', avgWaitTime);
    }

    /**
     * Set a metric value
     */
    private setMetric(name: string, value: number): void {
        if (!this.metrics.has(name)) {
            this.metrics.set(name, []);
        }

        const values = this.metrics.get(name)!;
        values.push(value);

        // Keep only recent history
        if (values.length > this.MAX_METRIC_HISTORY) {
            values.shift();
        }
    }

    /**
     * Get average of recent metric values
     */
    private getAverageMetric(name: string): number {
        const values = this.metrics.get(name) || [];
        if (values.length === 0) return 0;

        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    /**
     * Get latest metric value
     */
    private getLatestMetric(name: string): number {
        const values = this.metrics.get(name) || [];
        return values.length > 0 ? values[values.length - 1] : 0;
    }

    /**
     * Get overall metrics snapshot
     */
    getMetrics(): Partial<Metrics> {
        const avgQueryTime = this.queryTimes.length > 0
            ? this.queryTimes.reduce((a, b) => a + b, 0) / this.queryTimes.length
            : 0;

        const totalCache = this.cacheHits + this.cacheMisses;
        const hitRate = totalCache > 0 ? (this.cacheHits / totalCache) * 100 : 0;

        return {
            voiceCalls: {
                activeRooms: this.getLatestMetric('voice:active_rooms'),
                activeParticipants: this.getLatestMetric('voice:active_participants'),
                avgRoomSize: this.getLatestMetric('voice:avg_room_size'),
                totalProducers: 0, // Set by caller
                totalConsumers: 0, // Set by caller
            },
            randomCalls: {
                activeCalls: this.getLatestMetric('random:active_calls'),
                inQueue: this.getLatestMetric('random:in_queue'),
                avgWaitTime: this.getLatestMetric('random:avg_wait_time'),
                matchSuccessRate: 0, // Calculate from session data
            },
            database: {
                poolSize: 20, // From connection pooling config
                availableConnections: 0, // Set by caller
                queryCount: this.queryCount,
                avgQueryTime: Math.round(avgQueryTime),
                slowQueryCount: this.slowQueries,
            },
            cache: {
                hitRate: Math.round(hitRate),
                missRate: Math.round(100 - hitRate),
                evictionCount: 0, // From Redis
                totalEntries: 0, // From Redis
            },
            system: {
                memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                uptime: Math.floor((Date.now() - this.startTime) / 1000),
                cpuUsage: 0, // Platform specific
            },
        };
    }

    /**
     * Export metrics for Prometheus-style output
     */
    exportMetricsForPrometheus(): string {
        const metrics = this.getMetrics();
        const lines: string[] = [];

        lines.push('# HELP free2talk_voice_active_rooms Active voice rooms');
        lines.push('# TYPE free2talk_voice_active_rooms gauge');
        lines.push(`free2talk_voice_active_rooms ${metrics.voiceCalls?.activeRooms || 0}`);

        lines.push('# HELP free2talk_voice_active_participants Active voice participants');
        lines.push('# TYPE free2talk_voice_active_participants gauge');
        lines.push(`free2talk_voice_active_participants ${metrics.voiceCalls?.activeParticipants || 0}`);

        lines.push('# HELP free2talk_random_active_calls Active random calls');
        lines.push('# TYPE free2talk_random_active_calls gauge');
        lines.push(`free2talk_random_active_calls ${metrics.randomCalls?.activeCalls || 0}`);

        lines.push('# HELP free2talk_random_queue_size Users in matching queue');
        lines.push('# TYPE free2talk_random_queue_size gauge');
        lines.push(`free2talk_random_queue_size ${metrics.randomCalls?.inQueue || 0}`);

        lines.push('# HELP free2talk_db_query_count Total database queries');
        lines.push('# TYPE free2talk_db_query_count counter');
        lines.push(`free2talk_db_query_count ${metrics.database?.queryCount || 0}`);

        lines.push('# HELP free2talk_db_query_duration_ms Average query duration');
        lines.push('# TYPE free2talk_db_query_duration_ms gauge');
        lines.push(`free2talk_db_query_duration_ms ${metrics.database?.avgQueryTime || 0}`);

        lines.push('# HELP free2talk_cache_hit_rate Cache hit rate percent');
        lines.push('# TYPE free2talk_cache_hit_rate gauge');
        lines.push(`free2talk_cache_hit_rate ${metrics.cache?.hitRate || 0}`);

        lines.push('# HELP free2talk_memory_usage_mb Memory usage in MB');
        lines.push('# TYPE free2talk_memory_usage_mb gauge');
        lines.push(`free2talk_memory_usage_mb ${metrics.system?.memoryUsage || 0}`);

        lines.push('# HELP free2talk_uptime_seconds Server uptime');
        lines.push('# TYPE free2talk_uptime_seconds counter');
        lines.push(`free2talk_uptime_seconds ${metrics.system?.uptime || 0}`);

        return lines.join('\n');
    }

    /**
     * Reset metrics (for testing)
     */
    reset(): void {
        this.metrics.clear();
        this.queryTimes = [];
        this.slowQueries = 0;
        this.queryCount = 0;
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.startTime = Date.now();
    }

    /**
     * Log metrics summary
     */
    logSummary(): void {
        const metrics = this.getMetrics();

        console.log('\n=== Metrics Summary ===');
        console.log(`Voice Calls: ${metrics.voiceCalls?.activeRooms} rooms, ${metrics.voiceCalls?.activeParticipants} participants`);
        console.log(`Random Calls: ${metrics.randomCalls?.activeCalls} active, ${metrics.randomCalls?.inQueue} in queue`);
        console.log(`Database: ${metrics.database?.queryCount} queries, ${metrics.database?.avgQueryTime}ms avg`);
        console.log(`Cache: ${metrics.cache?.hitRate}% hit rate, ${metrics.cache?.totalEntries} entries`);
        console.log(`Memory: ${metrics.system?.memoryUsage}MB, Uptime: ${metrics.system?.uptime}s`);
        console.log('=====================\n');
    }
}

/**
 * Global metrics instance
 */
export const metricsCollector = new MetricsCollector();

/**
 * Timing helper for tracking function execution
 */
export async function trackMetric<T>(
    name: string,
    fn: () => Promise<T>
): Promise<T> {
    const start = performance.now();
    try {
        const result = await fn();
        const duration = performance.now() - start;
        metricsCollector.recordQuery(Math.round(duration), name);
        return result;
    } catch (error) {
        const duration = performance.now() - start;
        metricsCollector.recordQuery(Math.round(duration), `${name} (failed)`);
        throw error;
    }
}

/**
 * Synchronous timing helper
 */
export function trackMetricSync<T>(
    name: string,
    fn: () => T
): T {
    const start = performance.now();
    try {
        const result = fn();
        const duration = performance.now() - start;
        metricsCollector.recordQuery(Math.round(duration), name);
        return result;
    } catch (error) {
        const duration = performance.now() - start;
        metricsCollector.recordQuery(Math.round(duration), `${name} (failed)`);
        throw error;
    }
}
