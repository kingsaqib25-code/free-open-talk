import { NextResponse } from 'next/server';

/**
 * GET /api/spotify/token — app access token for Spotify Web API search.
 *
 * Server-only: SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET never leave the
 * server. The token is short-lived and cached in memory with its expiry,
 * so we don't hit accounts.spotify.com on every search.
 *
 * Client flow: fetch this route → use `access_token` as the Bearer token
 * against api.spotify.com/v1/search.
 */

let cached: { token: string; expiresAt: number } | null = null;

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Spotify not configured.' },
      { status: 503 }
    );
  }

  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return NextResponse.json({ access_token: cached.token });
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let res: Response;
  try {
    res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach Spotify.' },
      { status: 502 }
    );
  }
  if (!res.ok) {
    cached = null;
    return NextResponse.json(
      { error: 'Spotify rejected the app credentials.' },
      { status: 502 }
    );
  }
  const data = await res.json();
  cached = {
    token: data.access_token as string,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return NextResponse.json({ access_token: cached.token });
}
