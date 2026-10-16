/**
 * Voice Room Types
 * 
 * Shared types for voice room components.
 */

import type { VoiceConnectionState } from '@/lib/services/p2p/types';

export interface RoomData {
    id: string;
    name: string;
    slug?: string;
    topic?: string | null;
    languages: string[];
    maxParticipants: number;
    isActive?: boolean;
    ownerId: string;
    participants: RoomParticipant[];
    createdAt: string;
}

export interface RoomParticipant {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    isOwner: boolean;
    isMuted: boolean;
    isDeafened: boolean;
    isSpeaking: boolean;
    audioLevel: number;
    joinedAt: string;
}

export interface VoiceRoomState {
    connectionState: VoiceConnectionState;
    isMuted: boolean;
    isDeafened: boolean;
    localAudioLevel: number;
}

export interface RoomActions {
    join: () => Promise<void>;
    leave: () => Promise<void>;
    toggleMute: () => Promise<void>;
    kickUser: (userId: string) => Promise<void>;
    transferOwnership: (userId: string) => Promise<void>;
    closeRoom: () => Promise<void>;
}

