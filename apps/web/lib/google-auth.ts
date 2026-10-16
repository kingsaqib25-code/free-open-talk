/**
 * Google Sign In (one-tap, GIS) — client-side session helpers.
 *
 * Guest-first: Google is optional and purely additive. Linking stores the
 * Google profile in localStorage so the UI can render it instantly; the
 * authoritative link lives in Convex (googleLinks table) keyed by deviceId.
 */
import { getDeviceId } from './guest';

const LS_KEY = 'fot_google_profile';

export interface GoogleProfile {
  googleSub: string;
  email: string;
  name: string;
  picture?: string;
}

export function getGoogleClientId(): string {
  if (typeof process === 'undefined') return '';
  return (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
}

export function isGoogleConfigured(): boolean {
  return getGoogleClientId().length > 0;
}

export function getGoogleProfile(): GoogleProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.googleSub !== 'string') return null;
    return p as GoogleProfile;
  } catch {
    return null;
  }
}

export function saveGoogleProfile(p: GoogleProfile): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — session simply won't persist */
  }
}

export function clearGoogleProfile(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export function getDeviceIdSafe(): string {
  try {
    return getDeviceId();
  } catch {
    return 'ssr';
  }
}

/** Decode a Google ID-token payload (no verification — GIS verified it). */
export function decodeGoogleCredential(credential: string): GoogleProfile | null {
  try {
    const parts = credential.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(json);
    if (!payload.sub) return null;
    return {
      googleSub: String(payload.sub),
      email: String(payload.email ?? ''),
      name: String(payload.name ?? payload.email ?? 'Google user'),
      picture: payload.picture ? String(payload.picture) : undefined,
    };
  } catch {
    return null;
  }
}
