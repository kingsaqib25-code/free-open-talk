import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@free2talk/shared';

let socketInstance: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

export function setSocketInstance(io: Server<ClientToServerEvents, ServerToClientEvents>) {
    socketInstance = io;
}

export function getSocketInstance(): Server<ClientToServerEvents, ServerToClientEvents> | null {
    return socketInstance;
}

// Get the number of connected sockets in a room channel
export async function getRoomSocketCount(roomId: string): Promise<number> {
    if (!socketInstance) return 0;
    const sockets = await socketInstance.in(`room:${roomId}`).fetchSockets();
    return sockets.length;
}

// Broadcast to all sockets subscribed to the hallway
export function broadcastToHallway(event: string, data: any): void {
    if (socketInstance) {
        socketInstance.to('hallway').emit(event as any, data);
    }
}