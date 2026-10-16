export interface RoomWithParticipants {
    id: string;
    name: string;
    slug: string | null;
    ownerId: string;
    topic: string | null;
    languages: string[] | null;
    maxParticipants: number;
    isActive: boolean;
    createdAt: Date;
    closedAt: Date | null;
    participantCount: number;
    owner: {
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
    };
}

export interface ParticipantInfo {
    id: string;
    oderId: string; // Legacy typo - keeping for backwards compatibility
    userId: string; // Correct field name
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: 'owner' | 'participant';
    joinedAt: Date;
}