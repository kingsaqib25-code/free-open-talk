'use client';

/**
 * Room presence + heartbeat + chat, backed by Convex.
 * Replaces: use-room-socket.ts (Socket.io) + REST.
 *
 * Heartbeat every 10s keeps presence alive; server prunes at 30s.
 * NOTE: requires `npx convex dev` to have generated convex/_generated/.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { getDeviceId } from '@/lib/guest';

export interface RoomMediaState {
  muted: boolean;
  handRaised: boolean;
  videoOn: boolean;
  sharingScreen: boolean;
}

export function useConvexRoom(roomId: string, mediaState: RoomMediaState) {
  const deviceId = getDeviceId();
  const join = useMutation(api.presence.join);
  const heartbeat = useMutation(api.presence.heartbeat);
  const leave = useMutation(api.presence.leave);

  const [joinError, setJoinError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const participants = useQuery(
    api.presence.listForRoom,
    roomId ? { roomId: roomId as any } : 'skip'
  );
  const messages = useQuery(
    api.chat.list,
    roomId ? { roomId: roomId as any } : 'skip'
  );

  const stateRef = useRef(mediaState);
  stateRef.current = mediaState;

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    const nickname = localStorage.getItem('talkfree_nickname') || 'Guest';
    join({ roomId: roomId as any, deviceId, nickname })
      .then(() => {
        if (!cancelled) setJoined(true);
      })
      .catch((e) => {
        if (!cancelled)
          setJoinError(e instanceof Error ? e.message : 'Could not join room.');
      });

    const beat = () => {
      if (cancelled) return;
      heartbeat({
        roomId: roomId as any,
        deviceId,
        state: stateRef.current,
      }).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, 10_000);

    const onUnload = () => {
      // Best-effort leave; server prunes stale presence anyway.
      try {
        leave({ roomId: roomId as any, deviceId });
      } catch {}
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('beforeunload', onUnload);
      leave({ roomId: roomId as any, deviceId }).catch(() => {});
    };
  }, [roomId]);

  // Kicked/banned detection: we joined fine, but our participant row is gone
  // from the live list (host removed us). Surface it so the UI can explain.
  const wasRemoved =
    joined &&
    !joinError &&
    participants !== undefined &&
    !participants.some((p: any) => p.deviceId === deviceId);

  return { participants, messages, deviceId, joinError, wasRemoved };
}

export function useSendChat(roomId: string) {
  const send = useMutation(api.chat.send);
  const deviceId = getDeviceId();
  return async (
    text: string,
    replyTo?: { messageId: string; nickname: string; text: string }
  ) => {
    const nickname = localStorage.getItem('talkfree_nickname') || 'Guest';
    await send({
      roomId: roomId as any,
      deviceId,
      nickname,
      text,
      replyTo: replyTo
        ? {
            messageId: replyTo.messageId as any,
            nickname: replyTo.nickname,
            text: replyTo.text,
          }
        : undefined,
    });
  };
}

export function useReactToMessage(roomId: string) {
  const react = useMutation(api.chat.react);
  const deviceId = getDeviceId();
  return async (messageId: string, emoji: string) => {
    await react({ messageId: messageId as any, deviceId, emoji });
  };
}
