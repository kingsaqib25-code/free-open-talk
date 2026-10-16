import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL!;

if (!connectionString) {
    throw new Error('DATABASE_URL is not defined');
}

// ✨ Migration client - single connection for schema changes
export const migrationClient = postgres(connectionString, { max: 1 });

// ✨ OPTIMIZED: Query client with connection pooling
// Pool size tuned for optimal performance
const queryClient = postgres(connectionString, {
    // Connection pool configuration
    max: 20, // Maximum 20 concurrent connections
    idle_timeout: 30, // Close idle connections after 30 seconds
    connect_timeout: 10, // Wait max 10 seconds for connection
    statement_timeout: 5000, // Query timeout 5 seconds
    application_name: 'free2talk-api',

    // Performance optimizations
    prepare: true, // Use prepared statements for repeated queries

    // Error handling
    onnotice: (notice) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[DB Notice] ${notice.message}`);
        }
    },
});

// Connection pool monitoring
queryClient.on?.('error', (error) => {
    console.error('[DB Pool] Connection error:', error);
});

queryClient.on?.('connect', () => {
    console.log('[DB Pool] New connection established');
});

export const db = drizzle(queryClient, { schema });

// ✨ Export pool utilities for monitoring
export function getPoolStats() {
    return {
        count: queryClient.count,
        available: queryClient.available?.length || 0,
    };
}

// ✨ Graceful shutdown
export async function closeDatabase() {
    try {
        await queryClient.end();
        console.log('[DB] Connection pool closed');
    } catch (error) {
        console.error('[DB] Error closing connection pool:', error);
    }
}
