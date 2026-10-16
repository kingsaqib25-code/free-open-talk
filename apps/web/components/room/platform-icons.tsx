import type { AppKey } from './apps-panel';

/**
 * Hand-drawn SVG brand marks (keyless, no brand-CDN hotlinks).
 * Simple white line-art, 24x24, stroke = currentColor.
 */

type IconProps = { className?: string };

function Base({
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const YouTubeIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="6" width="19" height="12.5" rx="3.5" />
    <path d="M10.2 9.7v4.9l4.4-2.45z" fill="currentColor" stroke="none" />
  </Base>
);

const TikTokIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M14.5 4v10.2" />
    <circle cx="11.4" cy="16.4" r="2.9" />
    <path d="M14.5 4c.5 2.6 2.3 4.2 5 4.4" />
  </Base>
);

const TwitchIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 5.5h16v9.5l-3.5 3.5H12l-2.6 2.6v-2.6H4z" />
    <path d="M10 9v4M14 9v4" />
  </Base>
);

const VimeoIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 6.5c2.5.6 4 2.6 4.8 5.9l1.7 6.1 1.9-6.4c.8-2.8 2.2-4.5 4.6-5" />
  </Base>
);

const DailymotionIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M10 8.6l5.4 3.4-5.4 3.4z" fill="currentColor" stroke="none" />
  </Base>
);

const SpotifyIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M8 10.2c2.7-.8 5.4-.4 7.8 1M8.3 13c2.1-.6 4.2-.3 6 1M8.6 15.7c1.6-.4 3.1-.2 4.5.8" />
  </Base>
);

const XIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 5l14 14M19 5L5 19" />
  </Base>
);

const FacebookIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M14.8 8.2H16V5.4h-2.6c-2 0-3.2 1.4-3.2 3.4v2.4H8V14h2.2v6h2.9v-6h2.3l.5-2.8h-2.8V9c0-.5.2-.8.7-.8z" />
  </Base>
);

const InstagramIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="4" width="16" height="16" rx="4.5" />
    <circle cx="12" cy="12" r="3.6" />
    <circle cx="16.9" cy="7.6" r="0.9" fill="currentColor" stroke="none" />
  </Base>
);

const ScreenShareIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M9 20.5h6" />
    <path d="M7.5 11.5l2.3-2.3M9.8 9.2h-3v3" />
    <path d="M16.5 8.5l-2.3 2.3M14.2 10.8h3v-3" />
  </Base>
);

const WhiteboardIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="4" width="17" height="11.5" rx="1.5" />
    <path d="M8 19.5h8" />
    <path d="M7.5 8.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0" />
  </Base>
);

const DocumentIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6.5 3.5h7l4 4v13h-11z" />
    <path d="M13.5 3.5v4h4" />
    <path d="M9.3 12h5.4M9.3 15h5.4M9.3 18h3.4" />
  </Base>
);

const StreamingIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <path d="M8.6 8.6a4.8 4.8 0 000 6.8M15.4 8.6a4.8 4.8 0 010 6.8M6.2 6.2a8.2 8.2 0 000 11.6M17.8 6.2a8.2 8.2 0 010 11.6" />
  </Base>
);

const GameIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 8.5h10a4.5 4.5 0 014.4 5.4l-.7 2.9a2.4 2.4 0 01-4.2 1.1L14.5 16h-5l-2 1.9a2.4 2.4 0 01-4.2-1.1l-.7-2.9A4.5 4.5 0 017 8.5z" />
    <path d="M8.5 11.5v3M7 13h3" />
    <circle cx="15.8" cy="12.3" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="17.6" cy="14.3" r="0.8" fill="currentColor" stroke="none" />
  </Base>
);

const GamesPartyIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" transform="rotate(8 12 12)" />
    <circle cx="9.5" cy="11" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.8" cy="9.8" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.4" cy="14.6" r="1" fill="currentColor" stroke="none" />
  </Base>
);

const WatchPartyIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M10 8.8v6.4l5.2-3.2z" fill="currentColor" stroke="none" />
    <path d="M5.5 5.2l1.6 1.6M18.5 5.2l-1.6 1.6" />
  </Base>
);

const AppsGridIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="4" width="4.6" height="4.6" rx="1.2" />
    <rect x="9.7" y="4" width="4.6" height="4.6" rx="1.2" />
    <rect x="15.4" y="4" width="4.6" height="4.6" rx="1.2" />
    <rect x="4" y="9.7" width="4.6" height="4.6" rx="1.2" />
    <rect x="9.7" y="9.7" width="4.6" height="4.6" rx="1.2" />
    <rect x="15.4" y="9.7" width="4.6" height="4.6" rx="1.2" />
    <rect x="4" y="15.4" width="4.6" height="4.6" rx="1.2" />
    <rect x="9.7" y="15.4" width="4.6" height="4.6" rx="1.2" />
    <rect x="15.4" y="15.4" width="4.6" height="4.6" rx="1.2" />
  </Base>
);

const ICONS: Record<AppKey | 'apps', (p: IconProps) => React.ReactNode> = {
  youtube: YouTubeIcon,
  tiktok: TikTokIcon,
  twitch: TwitchIcon,
  vimeo: VimeoIcon,
  dailymotion: DailymotionIcon,
  spotify: SpotifyIcon,
  x: XIcon,
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  screenshare: ScreenShareIcon,
  whiteboard: WhiteboardIcon,
  document: DocumentIcon,
  streaming: StreamingIcon,
  game: GameIcon,
  gamesparty: GamesPartyIcon,
  watchparty: WatchPartyIcon,
  apps: AppsGridIcon,
};

export function PlatformIcon({
  app,
  className,
}: {
  app: AppKey | 'apps';
  className?: string;
}) {
  const Cmp = ICONS[app];
  return <Cmp className={className ?? 'h-8 w-8'} />;
}
