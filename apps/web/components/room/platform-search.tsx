'use client';

/**
 * platform-search.tsx — direct in-app search tabs for the Apps panel.
 *
 * Every platform works like YouTube: open the tile, search INSIDE the app,
 * tap a result → the whole room loads it together via sharedMedia.
 *
 * - Dailymotion: keyless public API + 1hr Convex cache (convex/dailymotion.ts)
 * - Twitch: Helix via server-side token route (/api/twitch/token); graceful
 *   "coming soon" + manual channel fallback when keys are missing
 * - Spotify: Web API via server-side token route (/api/spotify/token);
 *   curated playlist shortcuts as the no-key fallback
 *
 * Warm theme tokens match apps-panel.tsx.
 */

import { useEffect, useRef, useState } from 'react';
import { useConvex, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { PlatformIcon } from './platform-icons';

export interface PickTabProps {
  roomId: string;
  deviceId: string;
  toast: (msg: string) => void;
  onShared: () => void;
}

type SharePlatform =
  | 'tiktok'
  | 'twitch'
  | 'vimeo'
  | 'dailymotion'
  | 'spotify'
  | 'x'
  | 'facebook'
  | 'instagram';

const PLATFORM_LABEL: Record<SharePlatform, string> = {
  tiktok: 'TikTok',
  twitch: 'Twitch',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
  spotify: 'Spotify',
  x: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

function shareErr(e: unknown): string {
  if (e instanceof Error) {
    if (/Only the host can share media/.test(e.message))
      return 'Only the host can share — ask them to start it.';
    return e.message.slice(0, 120);
  }
  return 'Something went wrong.';
}

/** Shared "share this with the room" mutation wrapper. */
export function useSharePlatform(
  roomId: string,
  deviceId: string,
  toast: PickTabProps['toast'],
  onShared: PickTabProps['onShared']
) {
  const startMut = useMutation(api.sharedMedia.start);
  return async (
    platform: SharePlatform,
    ref: string,
    title?: string
  ): Promise<boolean> => {
    try {
      await startMut({
        roomId: roomId as never,
        deviceId,
        platform,
        ref: ref.slice(0, 500),
        title: title?.slice(0, 140),
      });
      toast(`Sharing ${PLATFORM_LABEL[platform]} with the room.`);
      onShared();
      return true;
    } catch (e) {
      toast(shareErr(e));
      return false;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Shared result row                                                   */
/* ------------------------------------------------------------------ */

export function SearchResultRow({
  thumbnail,
  title,
  subtitle,
  duration,
  onPick,
  disabled,
}: {
  thumbnail?: string;
  title: string;
  subtitle?: string;
  duration?: string;
  onPick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="flex w-full gap-3 rounded-xl p-2 text-left transition-colors hover:bg-[#2a2117] active:scale-[0.99] disabled:opacity-60"
    >
      <span className="relative aspect-video w-[120px] shrink-0 overflow-hidden rounded-lg bg-[#1a1410]">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <PlatformIcon app="apps" className="h-5 w-5 text-[#8a7d68]" />
          </span>
        )}
        {duration && (
          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
            {duration}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-sm font-medium leading-snug text-[#faf5ed]">
          {title}
        </span>
        {subtitle && (
          <span className="mt-1 block truncate text-xs text-[#8a7d68]">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus
      className="w-full rounded-xl border border-[#3a2d1e] bg-[#1a1410] px-4 py-3 text-sm text-[#faf5ed] placeholder-[#8a7d68] outline-none focus:border-[#f97316]"
    />
  );
}

function StatusLine({
  searching,
  searchedOnce,
  empty,
  error,
  hint,
}: {
  searching: boolean;
  searchedOnce: boolean;
  empty: boolean;
  error: string | null;
  hint: string;
}) {
  if (searching)
    return (
      <p className="py-8 text-center text-sm text-[#8a7d68]">Searching…</p>
    );
  if (error)
    return (
      <p className="py-8 text-center text-sm text-[#f87171]">{error}</p>
    );
  if (searchedOnce && empty)
    return (
      <p className="py-8 text-center text-sm text-[#8a7d68]">
        Nothing found — try different words.
      </p>
    );
  if (!searchedOnce)
    return (
      <p className="py-8 text-center text-sm text-[#8a7d68]">{hint}</p>
    );
  return null;
}

/* ------------------------------------------------------------------ */
/* Dailymotion — direct search, keyless public API + Convex cache       */
/* ------------------------------------------------------------------ */

interface DMResult {
  id: string;
  title: string;
  owner: string;
  thumbnail: string;
  duration: string;
}

function fmtDMSeconds(sec?: number): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function searchDailymotion(
  q: string,
  signal: AbortSignal
): Promise<DMResult[]> {
  const url = new URL('https://api.dailymotion.com/videos');
  url.searchParams.set('search', q);
  url.searchParams.set(
    'fields',
    'id,title,thumbnail_720_url,duration,owner.username'
  );
  url.searchParams.set('limit', '12');
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Dailymotion search failed (HTTP ${res.status}).`);
  const data = await res.json();
  return ((data?.list ?? []) as any[]).map((v) => ({
    id: String(v.id ?? ''),
    title: String(v.title ?? 'Untitled'),
    owner: String(v['owner.username'] ?? ''),
    thumbnail: String(v.thumbnail_720_url ?? ''),
    duration: fmtDMSeconds(Number(v.duration)),
  }));
}

export function DailymotionPickTab(props: PickTabProps) {
  const { toast, onShared } = props;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DMResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [busy, setBusy] = useState(false);
  const convex = useConvex();
  const share = useSharePlatform(props.roomId, props.deviceId, toast, onShared);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchedOnce(false);
      setSearchError(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const cached = await convex.query(api.dailymotion.searchCached, {
          query: q,
        });
        if (ctrl.signal.aborted) return;
        if (Array.isArray(cached) && cached.length > 0) {
          setResults(cached as DMResult[]);
          setSearchedOnce(true);
          return;
        }
        const items = await searchDailymotion(q, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setResults(items);
        setSearchedOnce(true);
        if (items.length > 0) {
          void convex
            .mutation(api.dailymotion.saveCache, {
              query: q,
              resultsJson: JSON.stringify(items),
            })
            .catch(() => {});
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        setSearchError(
          e instanceof Error ? e.message : 'Search failed.'
        );
        setSearchedOnce(true);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, convex]);

  const pick = async (r: DMResult) => {
    setBusy(true);
    try {
      await share('dailymotion', r.id, r.title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-1">
      <p className="text-xs text-[#8a7d68]">
        Search Dailymotion —{' '}
        <span className="text-[#fdba74]">plays together for everyone.</span>
      </p>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="Search Dailymotion…"
      />
      <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-0.5">
        <StatusLine
          searching={searching}
          searchedOnce={searchedOnce}
          empty={results.length === 0}
          error={searchError}
          hint="Type to search Dailymotion — tap a result and everyone watches together."
        />
        {results.map((r) => (
          <SearchResultRow
            key={r.id}
            thumbnail={r.thumbnail}
            title={r.title}
            subtitle={r.owner}
            duration={r.duration}
            disabled={busy}
            onPick={() => pick(r)}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Twitch — Helix search + "Top live now", token via server route       */
/* ------------------------------------------------------------------ */

interface TwitchResult {
  login: string;
  displayName: string;
  title: string;
  game: string;
  thumbnail: string;
  live: boolean;
}

async function twitchToken(): Promise<{ token: string; clientId: string } | null> {
  const res = await fetch('/api/twitch/token');
  if (!res.ok) return null; // 503 = keys not configured
  const data = await res.json();
  if (!data?.access_token) return null;
  return { token: data.access_token, clientId: data.client_id };
}

function twitchThumb(tpl?: string): string {
  return (tpl ?? '').replace('{width}', '320').replace('{height}', '180');
}

async function twitchSearch(
  token: string,
  clientId: string,
  q: string,
  signal: AbortSignal
): Promise<TwitchResult[]> {
  const url = new URL('https://api.twitch.tv/helix/search/channels');
  url.searchParams.set('query', q);
  url.searchParams.set('first', '12');
  url.searchParams.set('live_only', 'true');
  const res = await fetch(url.toString(), {
    signal,
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`Twitch search failed (HTTP ${res.status}).`);
  const data = await res.json();
  return ((data?.data ?? []) as any[]).map((c) => ({
    login: String(c.broadcaster_login ?? ''),
    displayName: String(c.display_name ?? c.broadcaster_login ?? ''),
    title: String(c.title ?? ''),
    game: String(c.game_name ?? ''),
    thumbnail: twitchThumb(c.thumbnail_url),
    live: c.is_live !== false,
  }));
}

async function twitchTopLive(
  token: string,
  clientId: string,
  signal: AbortSignal
): Promise<TwitchResult[]> {
  const url = new URL('https://api.twitch.tv/helix/streams');
  url.searchParams.set('first', '12');
  const res = await fetch(url.toString(), {
    signal,
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`Twitch browse failed (HTTP ${res.status}).`);
  const data = await res.json();
  return ((data?.data ?? []) as any[]).map((s) => ({
    login: String(s.user_login ?? ''),
    displayName: String(s.user_name ?? s.user_login ?? ''),
    title: String(s.title ?? ''),
    game: String(s.game_name ?? ''),
    thumbnail: twitchThumb(s.thumbnail_url),
    live: true,
  }));
}

export function TwitchPickTab(props: PickTabProps) {
  const { toast, onShared } = props;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TwitchResult[]>([]);
  const [topLive, setTopLive] = useState<TwitchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingTop, setLoadingTop] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState('');
  const credsRef = useRef<{ token: string; clientId: string } | null>(null);
  const share = useSharePlatform(props.roomId, props.deviceId, toast, onShared);

  // Fetch token once; load "Top live now" immediately.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      setLoadingTop(true);
      try {
        const creds = await twitchToken();
        if (cancelled) return;
        if (!creds) {
          setNotConfigured(true);
          return;
        }
        credsRef.current = creds;
        const top = await twitchTopLive(creds.token, creds.clientId, ctrl.signal);
        if (!cancelled) setTopLive(top);
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError' && !cancelled)
          setSearchError(e instanceof Error ? e.message : 'Failed to load Twitch.');
      } finally {
        if (!cancelled) setLoadingTop(false);
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  // Debounced channel search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !credsRef.current) {
      if (q.length < 2) {
        setResults([]);
        setSearchedOnce(false);
        setSearchError(null);
      }
      return;
    }
    const creds = credsRef.current;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const items = await twitchSearch(creds.token, creds.clientId, q, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setResults(items);
        setSearchedOnce(true);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        setSearchError(e instanceof Error ? e.message : 'Search failed.');
        setSearchedOnce(true);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const pick = async (r: TwitchResult) => {
    setBusy(true);
    try {
      await share(
        'twitch',
        r.login.toLowerCase(),
        r.title ? `${r.displayName} — ${r.title}` : r.displayName
      );
    } finally {
      setBusy(false);
    }
  };

  const shareChannel = async () => {
    const c = channel.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_]{4,25}$/.test(c)) {
      toast("That doesn't look like a Twitch channel name.");
      return;
    }
    setBusy(true);
    try {
      await share('twitch', c, c);
    } finally {
      setBusy(false);
    }
  };

  // Graceful state: keys not configured — tile still works via channel name.
  if (notConfigured) {
    return (
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-xs text-[#8a7d68]">
          Twitch search is <span className="text-[#fdba74]">coming soon</span> —
          for now, type a channel name and everyone watches it together.{' '}
          <span className="text-[#fdba74]">Play/pause sync (best effort).</span>
        </p>
        <input
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="Channel name, e.g. shroud"
          className="w-full rounded-xl border border-[#3a2d1e] bg-[#1a1410] px-4 py-3 text-sm text-[#faf5ed] placeholder-[#8a7d68] outline-none focus:border-[#f97316]"
        />
        <button
          disabled={busy || !channel.trim()}
          onClick={shareChannel}
          className="rounded-xl bg-[#f97316] px-4 py-3 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Sharing…' : 'Share Twitch with room'}
        </button>
      </div>
    );
  }

  const showingSearch = query.trim().length >= 2;

  return (
    <div className="flex flex-col gap-3 pt-1">
      <p className="text-xs text-[#8a7d68]">
        Search live streams or browse what's hot —{' '}
        <span className="text-[#fdba74]">play/pause sync (best effort).</span>
      </p>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="Search live Twitch channels…"
      />
      <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-0.5">
        {showingSearch ? (
          <>
            <StatusLine
              searching={searching}
              searchedOnce={searchedOnce}
              empty={results.length === 0}
              error={searchError}
              hint="Type to search live channels."
            />
            {results.map((r) => (
              <SearchResultRow
                key={r.login}
                thumbnail={r.thumbnail}
                title={r.title || r.displayName}
                subtitle={`${r.displayName}${r.game ? ` • ${r.game}` : ''} • LIVE`}
                disabled={busy}
                onPick={() => pick(r)}
              />
            ))}
          </>
        ) : (
          <>
            <p className="px-1 pt-1 text-xs font-semibold uppercase tracking-wider text-[#8a7d68]">
              Top live now
            </p>
            {loadingTop && (
              <p className="py-8 text-center text-sm text-[#8a7d68]">
                Loading live streams…
              </p>
            )}
            {!loadingTop && topLive.length === 0 && !searchError && (
              <p className="py-8 text-center text-sm text-[#8a7d68]">
                No live streams right now — try searching.
              </p>
            )}
            {searchError && (
              <p className="py-4 text-center text-sm text-[#f87171]">
                {searchError}
              </p>
            )}
            {topLive.map((r) => (
              <SearchResultRow
                key={r.login}
                thumbnail={r.thumbnail}
                title={r.title || r.displayName}
                subtitle={`${r.displayName}${r.game ? ` • ${r.game}` : ''}`}
                disabled={busy}
                onPick={() => pick(r)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Spotify — Web API search, token via server route                     */
/* ------------------------------------------------------------------ */

interface SpotifyResult {
  id: string;
  kind: 'track' | 'playlist';
  name: string;
  subtitle: string;
  image: string;
}

const SPOTIFY_SHORTCUTS: { name: string; id: string }[] = [
  { name: "Today's Top Hits", id: '37i9dQZF1DXcBWIGoYBM5M' },
  { name: 'Peaceful Piano', id: '37i9dQZF1DX4sWSpwq3LiO' },
  { name: 'LoFi Beats', id: '37i9dQZF1DWWQRwui0ExPn' },
];

async function spotifyToken(): Promise<string | null> {
  const res = await fetch('/api/spotify/token');
  if (!res.ok) return null; // 503 = keys not configured
  const data = await res.json();
  return typeof data?.access_token === 'string' ? data.access_token : null;
}

async function searchSpotify(
  token: string,
  q: string,
  signal: AbortSignal
): Promise<SpotifyResult[]> {
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'track,playlist');
  url.searchParams.set('limit', '12');
  const res = await fetch(url.toString(), {
    signal,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify search failed (HTTP ${res.status}).`);
  const data = await res.json();
  const out: SpotifyResult[] = [];
  for (const t of (data?.tracks?.items ?? []) as any[]) {
    if (!t?.id) continue;
    out.push({
      id: t.id,
      kind: 'track',
      name: String(t.name ?? 'Untitled'),
      subtitle: `Track • ${(t.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(', ')}`,
      image: String(t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? ''),
    });
  }
  for (const p of (data?.playlists?.items ?? []) as any[]) {
    if (!p?.id) continue;
    out.push({
      id: p.id,
      kind: 'playlist',
      name: String(p.name ?? 'Untitled'),
      subtitle: `Playlist${p.owner?.display_name ? ` • ${p.owner.display_name}` : ''}`,
      image: String(p.images?.[1]?.url ?? p.images?.[0]?.url ?? ''),
    });
  }
  return out.slice(0, 12);
}

export function SpotifyPickTab(props: PickTabProps) {
  const { toast, onShared } = props;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const tokenTried = useRef(false);
  const share = useSharePlatform(props.roomId, props.deviceId, toast, onShared);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchedOnce(false);
      setSearchError(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        if (!tokenRef.current && !tokenTried.current) {
          tokenTried.current = true;
          tokenRef.current = await spotifyToken();
          if (ctrl.signal.aborted) return;
          if (!tokenRef.current) {
            setNotConfigured(true);
            return;
          }
        }
        if (!tokenRef.current) {
          setNotConfigured(true);
          return;
        }
        const items = await searchSpotify(tokenRef.current, q, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setResults(items);
        setSearchedOnce(true);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        setSearchError(e instanceof Error ? e.message : 'Search failed.');
        setSearchedOnce(true);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const pick = async (r: SpotifyResult) => {
    setBusy(true);
    try {
      await share('spotify', `${r.kind}/${r.id}`, `${r.name} — ${r.subtitle}`);
    } finally {
      setBusy(false);
    }
  };

  const pickShortcut = async (id: string, name: string) => {
    setBusy(true);
    try {
      await share('spotify', `playlist/${id}`, name);
    } finally {
      setBusy(false);
    }
  };

  const shortcuts = (
    <div className="flex flex-wrap gap-2">
      {SPOTIFY_SHORTCUTS.map((p) => (
        <button
          key={p.id}
          disabled={busy}
          onClick={() => pickShortcut(p.id, p.name)}
          className="rounded-full border border-[#3a2d1e] bg-[#2a2117] px-3 py-1.5 text-xs font-medium text-[#faf5ed] active:scale-95 disabled:opacity-50"
        >
          {p.name}
        </button>
      ))}
    </div>
  );

  // Graceful state: keys not configured — curated playlists still work.
  if (notConfigured) {
    return (
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-xs text-[#8a7d68]">
          Spotify search is <span className="text-[#fdba74]">coming soon</span> —
          meanwhile, tap a playlist and everyone listens together.
        </p>
        {shortcuts}
        <p className="text-[11px] text-[#8a7d68]">
          Only the room host can start sharing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <p className="text-xs text-[#8a7d68]">
        Search tracks & playlists —{' '}
        <span className="text-[#fdba74]">everyone listens together.</span>
      </p>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="Search Spotify…"
      />
      {query.trim().length < 2 && shortcuts}
      <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-0.5">
        <StatusLine
          searching={searching}
          searchedOnce={searchedOnce}
          empty={results.length === 0}
          error={searchError}
          hint="Type to search Spotify — tap a result and everyone listens together."
        />
        {results.map((r) => (
          <SearchResultRow
            key={`${r.kind}-${r.id}`}
            thumbnail={r.image}
            title={r.name}
            subtitle={r.subtitle}
            disabled={busy}
            onPick={() => pick(r)}
          />
        ))}
      </div>
    </div>
  );
}
