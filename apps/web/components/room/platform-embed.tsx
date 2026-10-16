import { useRef } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { AppKey } from './apps-panel';

/**
 * PlatformEmbed — the shared viewer. Subscribes to the active
 * `sharedMedia` session for the room (convex/sharedMedia.ts) and loads the
 * SAME keyless embed on every device at the same time.
 *
 * Honest sync labels:
 *  - youtube:        "synced playback" (existing watchparty flow, not this row)
 *  - twitch/vimeo/dailymotion: "play/pause sync (best effort)"
 *  - everything else: "plays together"
 */

export interface SharedMediaSession {
  platform: string;
  ref: string;
  title?: string;
  hostDeviceId: string;
  createdAt: number;
}

/** Build the keyless embed URL for a stored (platform, ref) pair. */
export function buildEmbedUrl(platform: string, ref: string): string {
  switch (platform) {
    case 'tiktok':
      return `https://www.tiktok.com/embed/v2/${encodeURIComponent(ref)}`;
    case 'twitch':
      return `https://player.twitch.tv/?channel=${encodeURIComponent(ref)}&parent=${encodeURIComponent(window.location.hostname)}&muted=true`;
    case 'vimeo':
      return `https://player.vimeo.com/video/${encodeURIComponent(ref)}`;
    case 'dailymotion':
      return `https://www.dailymotion.com/embed/video/${encodeURIComponent(ref)}`;
    case 'spotify':
      return `https://open.spotify.com/embed/${ref.replace(/^\/+/, '')}`;
    case 'x':
      // Official widgets.js embed (srcDoc) — videos play, unlike the static Tweet.html endpoint.
      return `x-srcdoc:${encodeURIComponent(ref)}`;
    case 'facebook':
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(ref)}&show_text=false`;
    case 'instagram':
      return ref; // raw link; sandboxed viewer, IG limits embedding (see note below)
    default:
      return ref;
  }
}

/** Official Twitter widgets.js embed HTML (videos play reliably). Rendered via iframe srcDoc. */
export function buildXEmbedHtml(tweetId: string): string {
  const url = `https://x.com/i/status/${encodeURIComponent(tweetId)}`;
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:#000;display:flex;justify-content:center;min-height:100%}.twitter-tweet{margin:12px auto!important;max-width:550px;width:100%}</style></head><body><blockquote class="twitter-tweet" data-theme="dark" data-dnt="true"><a href="${url}"></a></blockquote><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></body></html>`;
}

const SYNC_LABEL: Record<string, string> = {
  twitch: 'play/pause sync (best effort)',
  vimeo: 'play/pause sync (best effort)',
  dailymotion: 'play/pause sync (best effort)',
};

export function PlatformEmbed({
  roomId,
  deviceId,
}: {
  roomId: string;
  deviceId: string;
}) {
  const session = useQuery(
    api.sharedMedia.get,
    roomId ? { roomId: roomId as never } : 'skip'
  ) as SharedMediaSession | null | undefined;
  const stopMut = useMutation(api.sharedMedia.stop);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  if (!session) return null;

  const platform = session.platform as AppKey;
  const iAmHost = session.hostDeviceId === deviceId;
  const syncLabel = SYNC_LABEL[session.platform] ?? 'plays together';
  const isInstagram = session.platform === 'instagram';
  const isX = session.platform === 'x';
  const embedUrl = buildEmbedUrl(session.platform, session.ref);
  const xSrcDoc = isX
    ? buildXEmbedHtml(decodeURIComponent(embedUrl.replace(/^x-srcdoc:/, '')))
    : null;

  /** Best-effort host play/pause relay via postMessage. */
  const relay = (action: 'play' | 'pause') => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      if (session.platform === 'vimeo') {
        win.postMessage(JSON.stringify({ method: action }), '*');
      } else if (session.platform === 'dailymotion') {
        win.postMessage(JSON.stringify({ command: action }), '*');
      }
    } catch {
      /* best effort only */
    }
  };

  const stop = async () => {
    try {
      await stopMut({ roomId: roomId as never, deviceId });
    } catch {
      /* host-only; viewers can't stop */
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#3a2d1e] bg-[#211a13] shadow-[0_4px_20px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#faf5ed]">
            {session.title || `Shared from ${session.platform}`}
          </p>
          <p className="text-xs text-[#8a7d68]">{syncLabel}</p>
        </div>
        {(session.platform === 'vimeo' ||
          session.platform === 'dailymotion') &&
          iAmHost && (
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => relay('play')}
                className="rounded-full bg-[#f97316] px-3 py-1.5 text-xs font-semibold text-white active:scale-95"
              >
                Play
              </button>
              <button
                onClick={() => relay('pause')}
                className="rounded-full border border-[#3a2d1e] bg-[#2a2117] px-3 py-1.5 text-xs font-semibold text-[#faf5ed] active:scale-95"
              >
                Pause
              </button>
            </div>
          )}
        {iAmHost && (
          <button
            onClick={stop}
            className="shrink-0 rounded-full border border-[#3a2d1e] bg-[#2a2117] px-3 py-1.5 text-xs font-semibold text-[#f87171] active:scale-95"
          >
            Stop
          </button>
        )}
      </div>
      <div className="aspect-video w-full bg-black">
        {isInstagram ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-[#c9bda9]">
              Instagram limits embedding, so this opens in a sandboxed viewer.
            </p>
            <iframe
              ref={iframeRef}
              src={embedUrl}
              title="Instagram shared link"
              className="h-full w-full rounded-lg bg-[#14100c]"
              sandbox="allow-scripts allow-same-origin allow-popups"
              loading="lazy"
            />
            <a
              href={session.ref}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-[#f97316] px-4 py-2 text-xs font-semibold text-white"
            >
              Open in Instagram
            </a>
          </div>
        ) : isX && xSrcDoc ? (
          <iframe
            ref={iframeRef}
            srcDoc={xSrcDoc}
            title={session.title || 'Shared tweet'}
            className="h-full w-full bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            loading="lazy"
          />
        ) : (
          <iframe
            ref={iframeRef}
            src={embedUrl}
            title={session.title || `Shared ${session.platform} media`}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            loading="lazy"
          />
        )}
      </div>
    </div>
  );
}
