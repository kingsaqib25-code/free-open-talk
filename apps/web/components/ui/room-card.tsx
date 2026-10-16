'use client';

import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/design-system';
import { Card } from './card';
import { Avatar, AvatarGroup } from './avatar';
import { LanguageBadge, ParticipantBadge } from './badge';
import { VoiceWaveIcon } from './icons';
import ProHostBorder from '@/components/engagement/ProHostBorder';
import TierBadge from '@/components/engagement/TierBadge';

export interface RoomCardProps {
    id: string;
    name: string;
    topic?: string;
    languages: string[];
    participantCount: number;
    maxParticipants: number;
    owner: {
        id: string;
        username: string;
        displayName?: string;
        avatarUrl?: string;
    };
    participants?: Array<{
        id: string;
        username: string;
        avatarUrl?: string;
        isSpeaking?: boolean;
    }>;
    isLive?: boolean;
    /** Skill level label shown in italic grey next to the language name (e.g. "Beginner"). */
    level?: string;
    /** Passthrough on the root div — e.g. a Pro-host animated border wrapper. */
    className?: string;
}

export function RoomCard({
    id,
    name,
    topic,
    languages,
    participantCount,
    maxParticipants,
    owner,
    participants = [],
    isLive = true,
    level,
    className,
}: RoomCardProps) {
    const isFull = participantCount >= maxParticipants;
    const primaryLanguage = languages[0] ?? name;

    // Host trust: Pro+ hosts (30+ day streak) get the animated award border.
    const hostStreak = useQuery(api.streaks.hostStreak, { deviceId: owner.id }) ?? 0;
    const isProHost = hostStreak >= 30;

    // Owner first, then participants — overlapping circular avatars.
    const avatarList = [
        {
            src: owner.avatarUrl,
            alt: owner.displayName || owner.username,
            fallback: owner.displayName || owner.username,
        },
        ...participants.map((p) => ({
            src: p.avatarUrl,
            alt: p.username,
            fallback: p.username,
        })),
    ];

    const cardBody = (
        <div className="flex h-full flex-col gap-3 p-4">
            {/* Top row: language badges + live/full indicator */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                    {languages.slice(0, 2).map((lang) => (
                        <LanguageBadge key={lang} language={lang} size="sm" />
                    ))}
                    {languages.length > 2 && (
                        <span className="text-xs text-text-tertiary">+{languages.length - 2}</span>
                    )}
                </div>
                {isFull ? (
                    <span className="inline-flex items-center rounded-full border border-status-warning/30 bg-status-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-warning">
                        Full
                    </span>
                ) : (
                    isLive && (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-voice-speaking">
                            <VoiceWaveIcon className="h-4 w-4" />
                            Live
                        </span>
                    )
                )}
            </div>

            {/* Language (bold) + level (italic grey) */}
            <div>
                <h3 className="text-base leading-snug text-text-primary transition-colors group-hover:text-primary-300">
                    <span className="font-bold">{primaryLanguage}</span>
                    {level && (
                        <span className="font-normal italic text-text-tertiary"> · {level}</span>
                    )}
                </h3>
                {/* Room name */}
                <p className="mt-0.5 line-clamp-1 text-sm text-text-secondary">{name}</p>
                {/* Topic line — emoji-friendly */}
                {topic && (
                    <p className="mt-0.5 line-clamp-1 text-sm text-text-secondary/90">{topic}</p>
                )}
            </div>

            {/* Overlapping member avatars + live count + host trust */}
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <AvatarGroup avatars={avatarList} max={4} size="sm" />
                <div className="flex flex-col items-end gap-1">
                    <span className="whitespace-nowrap text-xs text-text-secondary">
                        <span className="font-semibold text-text-primary">{participantCount}</span>{' '}
                        talking now
                    </span>
                    {hostStreak > 0 && (
                        <span className="flex items-center gap-1.5">
                            <TierBadge streak={hostStreak} size="sm" />
                            {hostStreak >= 2 && (
                                <span className="whitespace-nowrap text-[11px] text-text-tertiary">
                                    🔥 {hostStreak}d host streak
                                </span>
                            )}
                        </span>
                    )}
                </div>
            </div>

            {/* Join CTA — dashed border; whole card is clickable when not full */}
            <span
                className={cn(
                    'block rounded-xl border-2 border-dashed px-4 py-2.5 text-center text-sm font-semibold transition-all duration-200',
                    isFull
                        ? 'border-surface-border text-text-tertiary'
                        : 'border-primary-500/50 text-primary-300 group-hover:border-primary-400 group-hover:bg-primary-500/10 group-hover:text-primary-200'
                )}
            >
                {isFull ? 'Full' : 'Join and talk now!'}
            </span>
        </div>
    );

    return isProHost ? (
        <ProHostBorder>
            <div
                className={cn(
                    'group relative h-full overflow-hidden rounded-2xl border border-surface-border bg-surface-default',
                    'transition-all duration-300',
                    !isFull &&
                        'hover:-translate-y-1 hover:border-primary-500/40 hover:shadow-[0_16px_48px_-16px_rgba(249,115,22,0.35)]',
                    isFull && 'opacity-70',
                    className
                )}
            >
                {isFull ? (
                    <div className="h-full" aria-disabled="true">
                        {cardBody}
                    </div>
                ) : (
                    <Link
                        href={`/rooms/${id}`}
                        className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                        {cardBody}
                    </Link>
                )}
            </div>
        </ProHostBorder>
    ) : (
        <div
            className={cn(
                'group relative overflow-hidden rounded-2xl border border-surface-border bg-surface-default',
                'transition-all duration-300',
                !isFull &&
                    'hover:-translate-y-1 hover:border-primary-500/40 hover:shadow-[0_16px_48px_-16px_rgba(249,115,22,0.35)]',
                isFull && 'opacity-70',
                className
            )}
        >
            {isFull ? (
                <div className="h-full" aria-disabled="true">
                    {cardBody}
                </div>
            ) : (
                <Link
                    href={`/rooms/${id}`}
                    className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                    {cardBody}
                </Link>
            )}
        </div>
    );
}

// Compact room card for lists
export function RoomCardCompact({
    id,
    name,
    topic,
    languages,
    participantCount,
    maxParticipants,
    owner,
    isLive = true,
    level,
    className,
}: RoomCardProps) {
    const isFull = participantCount >= maxParticipants;

    return (
        <Link href={`/rooms/${id}`}>
            <Card
                variant="interactive"
                padding="sm"
                className={cn(
                    'flex items-center gap-3',
                    isFull && 'opacity-75',
                    className
                )}
            >
                {/* Avatar */}
                <Avatar
                    src={owner.avatarUrl}
                    alt={owner.displayName || owner.username}
                    fallback={owner.displayName || owner.username}
                    size="lg"
                    status={isLive ? 'speaking' : 'online'}
                    showStatus
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="font-medium text-text-primary truncate">
                            {name}
                        </h3>
                        {isLive && <VoiceWaveIcon className="h-4 w-4 text-voice-speaking flex-shrink-0" />}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-text-tertiary">
                            {owner.displayName || owner.username}
                        </span>
                        <span className="text-text-tertiary">·</span>
                        <div className="flex gap-1">
                            {languages.slice(0, 2).map((lang) => (
                                <LanguageBadge key={lang} language={lang} size="sm" />
                            ))}
                        </div>
                        {level && (
                            <span className="text-xs italic text-text-tertiary">{level}</span>
                        )}
                    </div>
                </div>

                {/* Count */}
                <ParticipantBadge count={participantCount} max={maxParticipants} size="sm" />
            </Card>
        </Link>
    );
}

// Skeleton loader for room cards
export function RoomCardSkeleton() {
    return (
        <Card variant="default" padding="none" className="overflow-hidden">
            <div className="p-4 pb-3 space-y-3">
                <div className="flex gap-2">
                    <div className="h-5 w-12 bg-surface-hover rounded animate-pulse" />
                    <div className="h-5 w-14 bg-surface-hover rounded animate-pulse" />
                </div>
                <div className="h-5 w-3/4 bg-surface-hover rounded animate-pulse" />
                <div className="h-4 w-1/2 bg-surface-hover rounded animate-pulse" />
            </div>
            <div className="px-4 py-3 bg-surface-hover/50 border-t border-surface-borderSubtle">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="h-6 w-6 bg-surface-hover rounded-full animate-pulse" />
                        <div className="h-4 w-20 bg-surface-hover rounded animate-pulse" />
                    </div>
                    <div className="h-5 w-12 bg-surface-hover rounded animate-pulse" />
                </div>
            </div>
        </Card>
    );
}
