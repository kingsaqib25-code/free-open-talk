'use client';

/**
 * Hallway (room directory) — Convex edition.
 *
 * Reads live room data via useRoomDirectory (Convex reactive query).
 * No login wall: guests browse freely.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/design-system';
import { useRoomDirectory } from '@/lib/hooks/use-convex-rooms';
import {
    Section,
    RoomCard,
    RoomCardSkeleton,
    Button,
    Input,
} from '@/components/ui';
import {
    Plus,
    Users,
    Search,
    Wifi,
} from '@/components/ui/icons';

const LANGUAGES = [
    'English', 'Spanish', 'French', 'German', 'Japanese',
    'Korean', 'Chinese', 'Portuguese', 'Russian', 'Italian',
    'Arabic', 'Hindi', 'Urdu', 'Dutch', 'Swedish', 'Polish',
];

interface RoomListItem {
    id: string;
    name: string;
    topic?: string;
    languages: string[];
    participantCount: number;
    maxParticipants: number;
    level?: string;
    owner: {
        id: string;
        username: string;
    };
}

export function HallwayContent() {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);

    // Live directory from Convex (reactive subscription, no REST/Socket.io).
    const { rooms, isLoading } = useRoomDirectory(selectedLanguage ?? undefined);
    // Unfiltered directory — drives the live per-language room counts.
    const { rooms: allRooms } = useRoomDirectory();

    // Live room counts per language, e.g. { All: 12, English: 5, Urdu: 2 }.
    const languageCounts = useMemo(() => {
        const counts: Record<string, number> = { All: 0 };
        if (!allRooms) return counts;
        for (const room of allRooms) {
            counts.All += 1;
            const lang = (room as any).language as string | undefined;
            if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
        }
        return counts;
    }, [allRooms]);

    // Map Convex room docs onto the RoomCard prop shape.
    const items: RoomListItem[] = useMemo(() => {
        if (!rooms) return [];
        return rooms.map((room: any) => ({
            id: room._id,
            name: room.name,
            topic: room.topic,
            languages: room.language ? [room.language] : [],
            participantCount: room.participantCount ?? 0,
            maxParticipants: room.maxParticipants,
            level: room.level,
            owner: {
                id: room.ownerDeviceId,
                username: 'Host',
            },
        }));
    }, [rooms]);

    // Filter rooms by search query (client-side).
    const filteredRooms = useMemo(() => {
        if (!searchQuery.trim()) return items;
        const query = searchQuery.toLowerCase();
        return items.filter(
            (room) =>
                room.name.toLowerCase().includes(query) ||
                room.topic?.toLowerCase().includes(query) ||
                room.languages.some((l) => l.toLowerCase().includes(query))
        );
    }, [items, searchQuery]);

    // Stats.
    const activeRoomsCount = items.length;
    const totalParticipants = items.reduce((acc, r) => acc + r.participantCount, 0);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    };

    return (
        <div className="space-y-6">
            {/* Header with stats */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                {/* Stats */}
                <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5 text-text-secondary">
                        <div className="h-2 w-2 rounded-full bg-voice-speaking animate-pulse" />
                        <span>{activeRoomsCount} active room{activeRoomsCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-text-secondary">
                        <Users className="h-4 w-4" />
                        <span>{totalParticipants} people talking</span>
                    </div>
                    {/* Live Convex subscription indicator */}
                    <div className="flex items-center gap-1.5 text-xs text-status-success">
                        <Wifi className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Live</span>
                    </div>
                </div>

                {/* Create room button — no auth gate, guests welcome */}
                <Button asChild size="sm" className="w-full sm:w-auto">
                    <Link href="/rooms/create">
                        <Plus className="h-4 w-4" />
                        Create Room
                    </Link>
                </Button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                <Input
                    placeholder="Search rooms, languages, topics..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    className="pl-9"
                />
            </div>

            {/* Language filter pills with live room counts */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                <FilterPill
                    label="All"
                    count={languageCounts.All}
                    active={selectedLanguage === null}
                    onClick={() => setSelectedLanguage(null)}
                />
                {LANGUAGES.map((lang) => (
                    <FilterPill
                        key={lang}
                        label={lang}
                        count={languageCounts[lang] ?? 0}
                        active={selectedLanguage === lang}
                        onClick={() =>
                            setSelectedLanguage(selectedLanguage === lang ? null : lang)
                        }
                    />
                ))}
            </div>

            {/* Room Grid */}
            <Section>
                {isLoading ? (
                    // Initial loading skeleton
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <RoomCardSkeleton key={i} />
                        ))}
                    </div>
                ) : filteredRooms.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredRooms.map((room) => (
                            <RoomCard key={room.id} {...room} />
                        ))}
                    </div>
                ) : (
                    // Empty state
                    <EmptyState
                        searchQuery={searchQuery}
                        onClearSearch={() => setSearchQuery('')}
                    />
                )}
            </Section>
        </div>
    );
}

function FilterPill({
    label,
    count,
    active,
    onClick,
}: {
    label: string;
    count?: number;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
                active
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-hover text-text-secondary hover:text-text-primary'
            )}
        >
            {label}
            {count !== undefined && (
                <span className={cn('ml-1.5', active ? 'text-white/80' : 'text-text-tertiary')}>
                    · {count}
                </span>
            )}
        </button>
    );
}

// Empty state component
function EmptyState({
    searchQuery,
    onClearSearch,
}: {
    searchQuery: string;
    onClearSearch: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-hover flex items-center justify-center mb-4">
                <Users className="h-8 w-8 text-text-tertiary" />
            </div>

            <h3 className="text-lg font-semibold text-text-primary mb-2">
                {searchQuery ? 'No rooms found' : 'No active rooms'}
            </h3>

            <p className="text-text-secondary text-sm max-w-md mb-6">
                {searchQuery
                    ? `No rooms match "${searchQuery}". Try a different search or create a new room.`
                    : 'Be the first to create a room and start practicing — no sign-up needed!'
                }
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
                {searchQuery && (
                    <Button variant="outline" onClick={onClearSearch}>
                        Clear Search
                    </Button>
                )}
                <Button asChild>
                    <Link href="/rooms/create">
                        <Plus className="h-4 w-4" />
                        Create Room
                    </Link>
                </Button>
            </div>
        </div>
    );
}
