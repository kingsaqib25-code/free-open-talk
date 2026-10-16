import { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { PlatformIcon } from './platform-icons';
import {
  YouTubePickTab,
  ScreenShareShareButton,
  useWatchParty,
} from './watch-party';

export type AppKey =
  | 'youtube'
  | 'tiktok'
  | 'twitch'
  | 'vimeo'
  | 'dailymotion'
  | 'spotify'
  | 'x'
  | 'facebook'
  | 'instagram'
  | 'screenshare'
  | 'whiteboard'
  | 'document'
  | 'streaming'
  | 'game'
  | 'gamesparty'
  | 'watchparty';

const LABELS: Record<AppKey, string> = {
  youtube: 'Youtube',
  tiktok: 'TikTok',
  twitch: 'Twitch',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
  spotify: 'Spotify',
  x: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
  screenshare: 'Screen Share',
  whiteboard: 'Whiteboard',
  document: 'Document',
  streaming: 'Go Live',
  game: 'Video Game',
  gamesparty: 'Games Party',
  watchparty: 'Watch Party',
};

/** Honest sync copy shown under each tile / input. */
const SYNC_NOTE: Partial<Record<AppKey, string>> = {
  youtube: 'Synced playback for everyone',
  twitch: 'Play/pause sync (best effort)',
  vimeo: 'Play/pause sync (best effort)',
  dailymotion: 'Play/pause sync (best effort)',
  streaming: 'Go live with screen + camera',
};

const SECTIONS: { title: string; apps: AppKey[] }[] = [
  {
    title: 'Watch & Listen',
    apps: [
      'youtube',
      'tiktok',
      'twitch',
      'vimeo',
      'dailymotion',
      'spotify',
      'watchparty',
    ],
  },
  { title: 'Share from platforms', apps: ['x', 'facebook', 'instagram'] },
  {
    title: 'Room tools',
    apps: ['screenshare', 'whiteboard', 'document', 'streaming', 'game', 'gamesparty'],
  },
];

/** Platforms that need a paste-a-link / channel input before sharing. */
const INPUT_APPS: AppKey[] = [
  'tiktok',
  'twitch',
  'vimeo',
  'dailymotion',
  'spotify',
  'x',
  'facebook',
  'instagram',
];

const INPUT_PLACEHOLDER: Partial<Record<AppKey, string>> = {
  tiktok: 'Paste a TikTok video link…',
  twitch: 'Channel name, e.g. shroud',
  vimeo: 'Paste a Vimeo video link…',
  dailymotion: 'Paste a Dailymotion video link…',
  spotify: 'Paste a Spotify playlist/track link…',
  x: 'Paste a post link from X…',
  facebook: 'Paste a public Facebook post/video link…',
  instagram: 'Paste an Instagram link…',
};

const SPOTIFY_SHORTCUTS: { name: string; id: string }[] = [
  { name: "Today's Top Hits", id: '37i9dQZF1DXcBWIGoYBM5M' },
  { name: 'Peaceful Piano', id: '37i9dQZF1DX4sWSpwq3LiO' },
  { name: 'LoFi Beats', id: '37i9dQZF1DWWQRwui0ExPn' },
];

/** Parse a pasted URL / channel name into the embed-ready ref. */
function parseRef(app: AppKey, raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  switch (app) {
    case 'tiktok':
      m = s.match(/(?:video|\/v)\/(\d+)/);
      return m ? m[1] : /^\d+$/.test(s) ? s : null;
    case 'twitch': {
      m = s.match(/(?:twitch\.tv\/)?([A-Za-z0-9_]{4,25})\/?$/);
      return m ? m[1].toLowerCase() : null;
    }
    case 'vimeo':
      m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      return m ? m[1] : null;
    case 'dailymotion':
      m = s.match(/dailymotion\.com\/(?:video|embed\/video)\/([A-Za-z0-9]+)/);
      return m ? m[1] : null;
    case 'spotify':
      m =
        s.match(/open\.spotify\.com\/(playlist|track|album|episode)\/([A-Za-z0-9]+)/) ||
        s.match(/spotify:(playlist|track|album|episode):([A-Za-z0-9]+)/);
      return m ? `${m[1]}/${m[2]}` : null;
    case 'x':
      m = s.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
      return m ? m[1] : null;
    case 'facebook':
      return /facebook\.com|fb\.watch/.test(s) ? s : null;
    case 'instagram':
      return /instagram\.com/.test(s) ? s : null;
    default:
      return null;
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) {
    const m = e.message.match(/Only the host can share media/);
    if (m) return 'Only the host can share — ask them to start it.';
    return e.message.slice(0, 120);
  }
  return 'Something went wrong.';
}

/* ------------------------------------------------------------------ */
/* Input view: paste link → host starts a synced shared-media session  */
/* ------------------------------------------------------------------ */

function PlatformInputView({
  app,
  roomId,
  deviceId,
  onShared,
  toast,
}: {
  app: AppKey;
  roomId: string;
  deviceId: string;
  onShared: () => void;
  toast: (msg: string) => void;
}) {
  const [value, setValue] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const startMut = useMutation(api.sharedMedia.start);

  const share = async (override?: string) => {
    const raw = (override ?? value).trim();
    const ref = parseRef(app, raw);
    if (!ref) {
      toast("Couldn't read that link — paste the full URL.");
      return;
    }
    setBusy(true);
    try {
      await startMut({
        roomId: roomId as never,
        deviceId,
        platform: app as
          | 'tiktok'
          | 'twitch'
          | 'vimeo'
          | 'dailymotion'
          | 'spotify'
          | 'x'
          | 'facebook'
          | 'instagram',
        ref,
        title: title.trim() || undefined,
      });
      toast(`Sharing ${LABELS[app]} with the room.`);
      onShared();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-1">
      <p className="text-xs text-[#8a7d68]">
        {app === 'instagram'
          ? 'Instagram limits embedding — the link opens in a sandboxed viewer for everyone.'
          : 'Paste a link — the whole room loads it together.'}{' '}
        {SYNC_NOTE[app] ? (
          <span className="text-[#fdba74]">{SYNC_NOTE[app]}.</span>
        ) : (
          <span className="text-[#fdba74]">Plays together.</span>
        )}
      </p>
      {app === 'spotify' && (
        <div className="flex flex-wrap gap-2">
          {SPOTIFY_SHORTCUTS.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => share(`https://open.spotify.com/playlist/${p.id}`)}
              className="rounded-full border border-[#3a2d1e] bg-[#2a2117] px-3 py-1.5 text-xs font-medium text-[#faf5ed] active:scale-95 disabled:opacity-50"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={INPUT_PLACEHOLDER[app]}
        inputMode="url"
        className="w-full rounded-xl border border-[#3a2d1e] bg-[#1a1410] px-4 py-3 text-sm text-[#faf5ed] placeholder-[#8a7d68] outline-none focus:border-[#f97316]"
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title for the room (optional)"
        maxLength={140}
        className="w-full rounded-xl border border-[#3a2d1e] bg-[#1a1410] px-4 py-3 text-sm text-[#faf5ed] placeholder-[#8a7d68] outline-none focus:border-[#f97316]"
      />
      <button
        disabled={busy || !value.trim()}
        onClick={() => share()}
        className="rounded-xl bg-[#f97316] px-4 py-3 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? 'Sharing…' : `Share ${LABELS[app]} with room`}
      </button>
      <p className="text-[11px] text-[#8a7d68]">
        Only the room host can start sharing.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Apps panel                                                          */
/* ------------------------------------------------------------------ */

export function AppsPanel({
  roomId,
  deviceId,
  open,
  onClose,
  appViews,
}: {
  roomId: string;
  deviceId: string;
  open: boolean;
  onClose: () => void;
  appViews?: Partial<Record<AppKey, React.ReactNode>>;
}) {
  const [active, setActive] = useState<AppKey | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [ytBusy, setYtBusy] = useState(false);
  const wp = useWatchParty();

  const toast = (msg: string) => {
    setToastMsg(msg);
  };

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    if (!open) setActive(null);
  }, [open ]);

  if (!open) return null;

  const handleTile = (app: AppKey) => {
    if (app === 'watchparty') {
      // WatchPartyStartModal is mounted globally in room-content;
      // trigger it through context and close the sheet.
      wp.setStartOpen(true);
      onClose();
      return;
    }
    if (app === 'youtube') {
      setActive(app);
      return;
    }
    if (app === 'screenshare' || app === 'streaming') {
      setActive(app);
      return;
    }
    if (INPUT_APPS.includes(app)) {
      setActive(app);
      return;
    }
    // whiteboard / document / game / gamesparty come from appViews
    if (appViews?.[app]) {
      setActive(app);
      return;
    }
    toast(`${LABELS[app]} is coming soon.`);
  };

  const handleYouTubePick = async (watchUrl: string) => {
    setYtBusy(true);
    try {
      const err = await wp.startYouTube(watchUrl);
      if (err) {
        toast(errMsg(new Error(err)));
      } else {
        onClose();
      }
    } finally {
      setYtBusy(false);
    }
  };

  const activeTitle = active ? LABELS[active] : '';

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <button
        aria-label="Close apps panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-hidden rounded-t-3xl border-t border-[#3a2d1e] bg-[#14100c]">
        {/* header */}
        <div className="flex items-center gap-3 px-5 pb-2 pt-3">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-[#3a2d1e]" />
        </div>
        <div className="flex items-center justify-between px-5 py-2">
          {active ? (
            <button
              onClick={() => setActive(null)}
              className="flex items-center gap-1.5 text-sm font-medium text-[#fdba74] active:scale-95"
            >
              <span aria-hidden="true">←</span> Back
            </button>
          ) : (
            <h2 className="text-base font-bold text-[#faf5ed]">Room apps</h2>
          )}
          {active && (
            <h2 className="text-base font-bold text-[#faf5ed]">{activeTitle}</h2>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2a2117] text-lg text-[#c9bda9] active:scale-95"
          >
            ×
          </button>
        </div>

        {/* body */}
        <div className="max-h-[68dvh] overflow-y-auto px-5 pb-8">
          {active === 'youtube' && (
            <div className="pt-1">
              <p className="mb-3 text-xs text-[#8a7d68]">
                Search YouTube or paste a link —{' '}
                <span className="text-[#fdba74]">
                  synced playback for everyone.
                </span>
              </p>
              <YouTubePickTab onPickUrl={handleYouTubePick} busy={ytBusy} />
            </div>
          )}

          {active && INPUT_APPS.includes(active) && (
            <PlatformInputView
              app={active}
              roomId={roomId}
              deviceId={deviceId}
              onShared={onClose}
              toast={toast}
            />
          )}

          {active === 'screenshare' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-center text-xs text-[#8a7d68]">
                Share your screen with everyone in the room.
              </p>
              <ScreenShareShareButton />
            </div>
          )}

          {active === 'streaming' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-center text-xs text-[#8a7d68]">
                Go live — share your screen with camera audio, straight into
                the room.
              </p>
              <ScreenShareShareButton />
            </div>
          )}

          {active &&
            appViews?.[active] &&
            !INPUT_APPS.includes(active) &&
            active !== 'youtube' &&
            active !== 'screenshare' &&
            active !== 'streaming' && <div className="pt-1">{appViews[active]}</div>}

          {!active &&
            SECTIONS.map((section) => (
              <div key={section.title} className="mt-4 first:mt-1">
                <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[#8a7d68]">
                  {section.title}
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  {section.apps.map((app) => (
                    <button
                      key={app}
                      onClick={() => handleTile(app)}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-[#3a2d1e] bg-[#211a13] px-2 py-4 active:scale-95 active:border-[#f97316]"
                    >
                      <PlatformIcon
                        app={app}
                        className="h-9 w-9 text-[#fdba74]"
                      />
                      <span className="text-xs font-medium text-[#faf5ed]">
                        {LABELS[app]}
                      </span>
                      {SYNC_NOTE[app] && (
                        <span className="text-center text-[10px] leading-tight text-[#8a7d68]">
                          {SYNC_NOTE[app]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>

        {/* toast */}
        {toastMsg && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6">
            <div className="rounded-full bg-[#2a2117] px-4 py-2.5 text-center text-sm font-medium text-[#faf5ed] shadow-lg ring-1 ring-[#f97316]/40">
              {toastMsg}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 3x3 grid icon button for the room toolbar. */
export function AppsPanelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open room apps"
      title="Apps"
      className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2a2117] text-[#fdba74] ring-1 ring-[#3a2d1e] transition active:scale-90"
    >
      <PlatformIcon app="apps" className="h-5 w-5" />
    </button>
  );
}
