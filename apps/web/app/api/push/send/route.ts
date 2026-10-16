import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import webpush from 'web-push';

/**
 * POST /api/push/send — send a Web Push notification.
 *
 * Body: { secret, deviceIds: string[], title, body, url? }
 * Auth: `secret` must equal PUSH_SEND_SECRET (server env).
 * VAPID: PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY + PUSH_VAPID_SUBJECT.
 *
 * $0 design: self-hosted Web Push, no vendor. Callers (future: @mention
 * notifier, room-invite cron) fetch subscriptions from Convex and POST here.
 */

export async function POST(req: NextRequest) {
  const sendSecret = process.env.PUSH_SEND_SECRET;
  if (!sendSecret) {
    return NextResponse.json(
      { error: 'Push not configured (PUSH_SEND_SECRET missing).' },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  if (body.secret !== sendSecret) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { deviceIds, title, body: text, url } = body;
  if (!Array.isArray(deviceIds) || deviceIds.length === 0 || !title) {
    return NextResponse.json(
      { error: 'deviceIds[] and title are required.' },
      { status: 400 }
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const vapidPublic = process.env.PUSH_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.PUSH_VAPID_PRIVATE_KEY;
  if (!convexUrl || !vapidPublic || !vapidPrivate) {
    return NextResponse.json(
      { error: 'Push not configured (Convex URL or VAPID keys missing).' },
      { status: 503 }
    );
  }

  webpush.setVapidDetails(
    process.env.PUSH_VAPID_SUBJECT || 'mailto:admin@free2talk.local',
    vapidPublic,
    vapidPrivate
  );

  const convex = new ConvexHttpClient(convexUrl);
  // String path avoids the not-yet-generated _generated/api import.
  const subs = (await convex.query('push:forDevices' as any, {
    deviceIds: deviceIds.slice(0, 50),
  })) as Array<{ endpoint: string; p256dh: string; auth: string; deviceId: string }>;

  const payload = JSON.stringify({
    title: String(title).slice(0, 80),
    body: String(text ?? '').slice(0, 160),
    url: typeof url === 'string' ? url.slice(0, 200) : '/',
  });

  let sent = 0;
  let dropped = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any,
          payload
        );
        sent++;
      } catch (err: any) {
        // 404/410 = subscription dead — prune it.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          try {
            await convex.mutation('push:unsubscribe' as any, { endpoint: s.endpoint });
          } catch {
            /* best effort */
          }
          dropped++;
        }
      }
    })
  );

  return NextResponse.json({ sent, dropped, total: subs.length });
}
