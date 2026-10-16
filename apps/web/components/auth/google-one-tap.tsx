'use client';

/**
 * Google Sign In — one-tap style, via Google Identity Services (GIS) script
 * directly (no heavy SDK). Guest-first: if the client ID is missing or the
 * Google script is blocked, this renders nothing and the app stays fully
 * guest-functional.
 *
 * On success the Google identity is LINKED to the guest deviceId in Convex
 * (auth.linkGoogle) so follows / friends / streaks survive across devices.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  getGoogleClientId,
  isGoogleConfigured,
  getGoogleProfile,
  saveGoogleProfile,
  clearGoogleProfile,
  decodeGoogleCredential,
  getDeviceIdSafe,
  type GoogleProfile,
} from '@/lib/google-auth';
import { cn } from '@/lib/design-system';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: {
            client_id: string;
            callback: (resp: { credential?: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            el: HTMLElement,
            opts: Record<string, unknown>
          ) => void;
          prompt: () => void;
          disableAutoSelect: () => void;
          cancel: () => void;
        };
      };
    };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisLoadPromise: Promise<boolean> | null = null;

function loadGis(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.google?.accounts?.id) return Promise.resolve(true);
  if (!gisLoadPromise) {
    gisLoadPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(!!window.google?.accounts?.id);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      // Safety timeout — never hang the UI on a blocked script.
      setTimeout(() => resolve(!!window.google?.accounts?.id), 8000);
    });
  }
  return gisLoadPromise;
}

/** The official GIS "Continue with Google" button. Renders null when unusable. */
export function GoogleSignInButton({
  onLinked,
  className,
}: {
  onLinked?: (profile: GoogleProfile) => void;
  className?: string;
}) {
  const btnRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const linkGoogle = useMutation(api.auth.linkGoogle);
  const deviceId = getDeviceIdSafe();

  const handleCredential = useCallback(
    async (resp: { credential?: string }) => {
      if (!resp.credential) return;
      const profile = decodeGoogleCredential(resp.credential);
      if (!profile) return;
      try {
        await linkGoogle({
          deviceId,
          googleSub: profile.googleSub,
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
        });
        saveGoogleProfile(profile);
        onLinked?.(profile);
      } catch {
        /* link failed — stay guest, button remains usable */
      }
    },
    [deviceId, linkGoogle, onLinked]
  );

  useEffect(() => {
    if (!isGoogleConfigured()) return;
    let cancelled = false;
    loadGis().then((ok) => {
      if (!ok || cancelled || !btnRef.current || !window.google) return;
      try {
        window.google.accounts.id.initialize({
          client_id: getGoogleClientId(),
          callback: handleCredential,
        });
        window.google.accounts.id.renderButton(btnRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          logo_alignment: 'left',
        });
        setReady(true);
      } catch {
        /* GIS refused (e.g. FedCM blocked) — stay silent, guest flow wins */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [handleCredential]);

  if (!isGoogleConfigured()) return null;
  return (
    <div className={cn('flex justify-center', className)}>
      <div ref={btnRef} aria-hidden={!ready} className={cn(!ready && 'opacity-0')} />
    </div>
  );
}

/**
 * Smart account section for the sidebar: linked → profile chip + sign out;
 * not linked → the Google button. Renders nothing when Google isn't
 * configured (pure guest mode).
 */
export function GoogleAccountSection({ collapsed }: { collapsed?: boolean }) {
  const [profile, setProfile] = useState<GoogleProfile | null>(null);
  const unlinkGoogle = useMutation(api.auth.unlinkGoogle);
  const deviceId = getDeviceIdSafe();

  useEffect(() => {
    setProfile(getGoogleProfile());
  }, []);

  const signOut = useCallback(async () => {
    try {
      await unlinkGoogle({ deviceId });
    } catch {
      /* best effort */
    }
    clearGoogleProfile();
    try {
      window.google?.accounts.id.disableAutoSelect();
    } catch {
      /* ignore */
    }
    setProfile(null);
  }, [deviceId, unlinkGoogle]);

  if (!isGoogleConfigured()) return null;

  if (profile) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border border-surface-border/50 bg-surface-hover/50 p-2',
          collapsed && 'justify-center p-1.5'
        )}
      >
        {profile.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.picture}
            alt={profile.name}
            className="h-8 w-8 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-500/20 text-sm font-bold text-primary-300">
            {profile.name.charAt(0).toUpperCase()}
          </div>
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {profile.name}
            </p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-xs text-text-tertiary hover:text-text-secondary hover:underline"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('px-1', collapsed && 'px-0')}>
      {!collapsed && (
        <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          Sync across devices
        </p>
      )}
      <GoogleSignInButton
        onLinked={(p) => setProfile(p)}
        className={collapsed ? '[&>div]:scale-90' : undefined}
      />
    </div>
  );
}
