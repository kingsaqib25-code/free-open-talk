'use client';

/**
 * Participant activity card — opens when you tap someone's avatar and
 * choose "View profile" in their menu, or tap their activity chip.
 *
 * Shows avatar, nickname, streak tier, Follow button, their LIVE activity,
 * and a contextual action (join watch / view screen / watch-join game /
 * open together).
 */

import { useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/design-system';
import { Avatar, Dialog, DialogContent } from '@/components/ui';
import TierBadge from '@/components/engagement/TierBadge';
import { useStreak } from '@/components/engagement/useStreak';
import { FollowButton } from '@/components/follows/follow-button';
import { openParticipantCard } from './participant-menu';
import { useWatchParty } from './watch-party';
import type { AppKey } from './apps-panel';
import type { ActivityKind } from '@/lib/activity';

export interface CardParticipant {
  deviceId: string;
  nickname: string;
  activity?: { kind: ActivityKind; label?: string; updatedAt: number } | null;
}

export const ACTIVITY_DISPLAY: Record<
  ActivityKind,
  { emoji: string; text: (label?: string) => string }
> = {
  watching: { emoji: '🎬', text: (l) => `Watching: ${l ?? 'together'}` },
  sharing: { emoji: '🖥️', text: () => 'Sharing screen' },
  whiteboard: { emoji: '🎨', text: () => 'Drawing on whiteboard' },
  gaming: { emoji: '🎮', text: () => 'In a game' },
  notes: { emoji: '📝', text: () => 'Taking notes' },
  talking: { emoji: '💬', text: () => 'Chatting' },
  idle: { emoji: '💤', text: () => 'Idle' },
};

function scrollToId(id: string) {
  requestAnimationFrame(() => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function ContextualAction({
  participant,
  myDeviceId,
  roomId,
  onClose,
  onOpenApp,
}: {
  participant: CardParticipant;
  myDeviceId: string;
  roomId: string;
  onClose: () => void;
  onOpenApp: (app: AppKey) => void;
}) {
  const kind = participant.activity?.kind ?? 'idle';
  const wp = useWatchParty();
  const game = useQuery(api.roomapps.getGame, {
    roomId: roomId as never,
  });

  const actionBtn =
    'w-full rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]';

  if (kind === 'watching') {
    return (
      <button
        type="button"
        className={actionBtn}
        onClick={() => {
          onClose();
          if (wp.session) {
            try {
              wp.setExpanded(true);
            } catch {
              /* overlay may not support it — best effort */
            }
          }
          scrollToId('fot-shared-media');
        }}
      >
        🎬 Join watch
      </button>
    );
  }

  if (kind === 'sharing') {
    return (
      <button
        type="button"
        className={actionBtn}
        onClick={() => {
          onClose();
          scrollToId(`fot-tile-${participant.deviceId}`);
        }}
      >
        🖥️ Viewing live
      </button>
    );
  }

  if (kind === 'gaming') {
    const mySeat =
      game?.playerX === myDeviceId
        ? 'X'
        : game?.playerO === myDeviceId
          ? 'O'
          : null;
    const slotFree = !game?.playerX || !game?.playerO || mySeat !== null;
    const gameOver = (game?.winner ?? '') !== '';
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={actionBtn}
          onClick={() => {
            onClose();
            onOpenApp('game');
          }}
        >
          🎮 Watch game
        </button>
        {slotFree && !gameOver && (
          <button
            type="button"
            className="w-full rounded-xl border border-primary-500/40 bg-primary-500/15 px-4 py-2.5 text-sm font-semibold text-primary-300 transition active:scale-[0.98]"
            onClick={() => {
              onClose();
              onOpenApp('game');
            }}
          >
            Join as player
          </button>
        )}
      </div>
    );
  }

  if (kind === 'whiteboard') {
    return (
      <button
        type="button"
        className={actionBtn}
        onClick={() => {
          onClose();
          onOpenApp('whiteboard');
        }}
      >
        🎨 Open together
      </button>
    );
  }

  if (kind === 'notes') {
    return (
      <button
        type="button"
        className={actionBtn}
        onClick={() => {
          onClose();
          onOpenApp('document');
        }}
      >
        📝 Open together
      </button>
    );
  }

  return null;
}

export function ParticipantCard({
  participant,
  myDeviceId,
  roomId,
  onClose,
  onOpenApp,
}: {
  participant: CardParticipant;
  myDeviceId: string;
  roomId: string;
  onClose: () => void;
  onOpenApp: (app: AppKey) => void;
}) {
  const { streak } = useStreak(participant.deviceId);
  const kind = participant.activity?.kind ?? 'idle';
  const display = ACTIVITY_DISPLAY[kind];
  const isLive = kind !== 'idle';

  return (
    <div className="flex flex-col items-center gap-3 px-2 py-2">
      <Avatar
        fallback={participant.nickname}
        alt={participant.nickname}
        size="3xl"
      />
      <div className="flex flex-col items-center gap-1.5">
        <p className="max-w-[220px] truncate text-lg font-bold text-text-primary">
          {participant.nickname}
        </p>
        <TierBadge streak={streak} size="sm" />
      </div>

      <FollowButton
        targetDeviceId={participant.deviceId}
        targetNickname={participant.nickname}
        size="md"
      />

      {/* LIVE activity line */}
      <div
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-2.5',
          isLive
            ? 'border-primary-500/40 bg-primary-500/10'
            : 'border-surface-borderSubtle bg-surface-default/50'
        )}
      >
        {isLive && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" />
          </span>
        )}
        <span className="text-sm font-semibold text-text-primary">
          <span aria-hidden className="mr-1.5">
            {display.emoji}
          </span>
          {display.text(participant.activity?.label)}
        </span>
      </div>

      <ContextualAction
        participant={participant}
        myDeviceId={myDeviceId}
        roomId={roomId}
        onClose={onClose}
        onOpenApp={onOpenApp}
      />
    </div>
  );
}

/**
 * Slim reactive strip of OTHER participants' live activities.
 * Chips like "🎬 Ali" / "🖥️ Sara" — tapping opens their activity card.
 * Hidden when nobody has a non-idle activity.
 */
export function RoomActivityBar({
  participants,
  myDeviceId,
}: {
  participants: CardParticipant[];
  myDeviceId: string;
}) {
  const active = participants.filter(
    (p) =>
      p.deviceId !== myDeviceId &&
      p.activity &&
      p.activity.kind !== 'idle'
  );
  if (active.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-surface-borderSubtle bg-gradient-to-r from-primary-500/10 via-transparent to-primary-500/10 px-4 py-1.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
        Live
      </span>
      {active.map((p) => {
        const d = ACTIVITY_DISPLAY[p.activity!.kind];
        return (
          <button
            key={p.deviceId}
            type="button"
            onClick={() => openParticipantCard(p.deviceId)}
            title={`${p.nickname} — ${d.text(p.activity?.label)}`}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary-500/30 bg-primary-500/10 px-3 py-1 text-xs font-medium text-text-primary transition hover:bg-primary-500/20 active:scale-95"
          >
            <span aria-hidden>{d.emoji}</span>
            <span className="max-w-[100px] truncate">{p.nickname}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Listens for 'fot:open-participant-card' (dispatched from ParticipantMenu)
 * and renders the card. Mount inside WatchPartyProvider + room.
 */
export function ParticipantCardHost({
  roomId,
  myDeviceId,
  participants,
  onOpenApp,
}: {
  roomId: string;
  myDeviceId: string;
  participants: CardParticipant[];
  onOpenApp: (app: AppKey) => void;
}) {
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ deviceId: string }>).detail?.deviceId;
      if (id) setOpenDeviceId(id);
    };
    window.addEventListener('fot:open-participant-card', handler);
    return () =>
      window.removeEventListener('fot:open-participant-card', handler);
  }, []);

  const participant = openDeviceId
    ? participants.find((p) => p.deviceId === openDeviceId) ?? null
    : null;

  return (
    <Dialog
      open={participant !== null}
      onOpenChange={(open) => {
        if (!open) setOpenDeviceId(null);
      }}
    >
      <DialogContent className="max-w-xs">
        {participant && (
          <ParticipantCard
            participant={participant}
            myDeviceId={myDeviceId}
            roomId={roomId}
            onClose={() => setOpenDeviceId(null)}
            onOpenApp={onOpenApp}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
