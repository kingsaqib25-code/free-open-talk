import * as mediasoup from 'mediasoup';
import { Worker } from 'mediasoup/types';
import { config } from '../../config/env.js';

let workers: Worker[] = [];
let nextWorkerIndex = 0;

export async function initMediasoupWorkers() {
    const numWorkers = process.env.MEDIASOUP_WORKERS
        ? parseInt(process.env.MEDIASOUP_WORKERS)
        : 3;

    console.log(`Starting ${numWorkers} mediasoup workers...`);

    for (let i = 0; i < numWorkers; i++) {
        const worker = await mediasoup.createWorker({
            logLevel: 'warn',
            logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
            rtcMinPort: parseInt(process.env.MEDIASOUP_RTC_MIN_PORT || '10000'),
            rtcMaxPort: parseInt(process.env.MEDIASOUP_RTC_MAX_PORT || '10100'),
        });

        worker.on('died', () => {
            console.error(`mediasoup worker ${worker.pid} died, exiting...`);
            process.exit(1);
        });

        // Enable WebRTC server for efficient connection handling in production
        if (config.nodeEnv === 'production') {
            try {
                console.log(`[Worker ${i + 1}] Initializing WebRTC server...`);
                await worker.createWebRtcServer({
                    listenInfos: [
                        {
                            protocol: 'udp',
                            ip: config.mediasoup.listenIp,
                            announcedIp: config.mediasoup.announcedIp,
                            port: 0, // Let the OS assign a port
                        },
                        {
                            protocol: 'tcp',
                            ip: config.mediasoup.listenIp,
                            announcedIp: config.mediasoup.announcedIp,
                            port: 0,
                        },
                    ],
                });
                console.log(`[Worker ${i + 1}] WebRTC server initialized`);
            } catch (error) {
                console.error(`[Worker ${i + 1}] Failed to create WebRTC server:`, error);
                // Non-fatal - WebRTC transports will still work
            }
        }

        workers.push(worker);
        console.log(`Worker ${i + 1} created (PID: ${worker.pid})`);
    }
}

export function getNextWorker(): Worker {
    const worker = workers[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
    return worker;
}

export function getWorkers(): Worker[] {
    return workers;
}
