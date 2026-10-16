import { NextResponse } from 'next/server';

/**
 * GET /api/twitch/token — app access token for Twitch Helix search.
 *
 * Server-only: TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET never leave the
 * server. The token is short-lived and cached in memory with its expiry,
 * so we don't hit id.twitch.tv on every search.
 *
 * Client flow: fetch this route → use `access_token` as the Bearer token
 * against api.twitch.tv/helix/* with the public Client-ID header.
 */

let cached: { token: string; expiresAt: number } | null = null;

export async function GET() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Twitch not configured.' },
      { status: 503 }
    );
  }

  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return NextResponse.json({
      access_token: cached.token,
      client_id: clientId,
    });
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  let res: Response;
  try {
    res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach Twitch.' },
      { status: 502 }
    );
  }
  if (!res.ok) {
    cached = null;
    return NextResponse.json(
      { error: 'Twitch rejected the app credentials.' },
      { status: 502 }
    );
  }
  const data = await res.json();
  cached = {
    token: data.access_token as string,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return NextResponse.json({
    access_token: cached.token,
    client_id: clientId,
  });
}
