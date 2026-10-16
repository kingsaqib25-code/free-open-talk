'use client';

/**
 * Shared room notepad — for language practice: vocab lists, phrases,
 * corrections. One text per room, last-write-wins.
 *
 * Saves are debounced (~800ms) and capped at 5000 chars server-side.
 * Remote edits stream in live; we never overwrite text the user is
 * actively typing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Check, Loader2, Edit, AlertCircle } from '@/components/ui/icons';
import { getDeviceId } from '@/lib/guest';
import { cn } from '@/lib/design-system';

const SAVE_DEBOUNCE_MS = 800;
const MAX_CHARS = 5000;

export function RoomNotepad({ roomId }: { roomId: string }) {
  const rid = roomId as Id<'rooms'>;
  const doc = useQuery(api.roomapps.getNotepad, { roomId: rid });
  const setTextMut = useMutation(api.roomapps.setText);

  const [text, setTextLocal] = useState('');
  const [dirty, setDirty] = useState(false); // unsaved local edits pending
  const [saveError, setSaveError] = useState<string | null>(null);
  const typingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  // Seed from the server once; adopt remote edits only when the user is
  // not actively typing (last-write-wins without stomping).
  useEffect(() => {
    if (doc === undefined) return;
    const remote = doc?.text ?? '';
    if (!typingRef.current && remote !== text) {
      setTextLocal(remote);
      lastSavedRef.current = remote;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.text]);

  const save = useCallback(
    (next: string) => {
      if (next === lastSavedRef.current) {
        setDirty(false);
        return;
      }
      const deviceId = getDeviceId();
      setTextMut({ roomId: rid, deviceId, text: next })
        .then(() => {
          lastSavedRef.current = next;
          setDirty(false);
        })
        .catch((err) => {
          setSaveError(
            err instanceof Error ? err.message : 'Could not save.'
          );
          setTimeout(() => setSaveError(null), 3000);
        });
    },
    [setTextMut, rid]
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value.slice(0, MAX_CHARS);
      typingRef.current = true;
      setTextLocal(next);
      setDirty(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        typingRef.current = false;
        save(next);
      }, SAVE_DEBOUNCE_MS);
    },
    [save]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const charsLeft = MAX_CHARS - text.length;
  const isLoading = doc === undefined;

  return (
    <div className="flex h-full min-h-[280px] flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
          <Edit size="sm" />
          Shared notes
        </div>
        <div className="flex items-center gap-1.5 text-xs text-amber-700">
          {isLoading || dirty ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size="xs" className="animate-spin" />
              {isLoading ? 'Loading…' : 'Saving…'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-amber-600">
              <Check size="xs" />
              saved
            </span>
          )}
        </div>
      </div>

      <textarea
        value={text}
        onChange={onChange}
        placeholder={
          'Practice together — vocab, new phrases, corrections…\n\n' +
          'Everything you write is visible to everyone in the room.'
        }
        disabled={isLoading}
        maxLength={MAX_CHARS}
        spellCheck
        className={cn(
          'flex-1 resize-none rounded-2xl border border-amber-200 bg-amber-50/50 p-4',
          'text-sm leading-relaxed text-amber-950 placeholder:text-amber-400',
          'outline-none transition-shadow focus:border-orange-400 focus:ring-2 focus:ring-orange-200',
          isLoading && 'opacity-60'
        )}
      />

      <div className="flex items-center justify-between text-[11px] text-amber-600">
        <span>Live for everyone in the room</span>
        <span className={cn(charsLeft < 200 && 'font-bold text-red-600')}>
          {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </span>
      </div>

      {saveError && (
        <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
          <AlertCircle size="xs" />
          {saveError}
        </div>
      )}
    </div>
  );
}
