'use client';

/**
 * PWA bootstrap: registers the service worker, captures the install
 * prompt, and offers a one-tap "Install app" button + push opt-in.
 * Rendered once in the root layout (client boundary).
 */
import { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { getDeviceId } from '@/lib/guest';
import { Button } from '@/components/ui';
import { Bell, Download, X } from '@/components/ui/icons';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PwaBootstrap() {
  const [installEvt, setInstallEvt] = useState<any>(null);
  const [pushState, setPushState] = useState<'unknown' | 'on' | 'off' | 'unsupported'>('unknown');
  const [dismissed, setDismissed] = useState(false);
  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    return () => window.removeEventListener('beforeinstallprompt', onInstall);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported');
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushState(sub ? 'on' : 'off'))
      .catch(() => setPushState('unsupported'));
  }, []);

  const handleInstall = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => {});
    setInstallEvt(null);
  };

  const handlePushToggle = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushState === 'on') {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await unsubscribe({ endpoint: sub.endpoint });
        }
        setPushState('off');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      const vapidKey = process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.warn('[pwa] NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY not set — push disabled');
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as ArrayBuffer,
      });
      const json = sub.toJSON();
      await subscribe({
        deviceId: getDeviceId(),
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
      });
      setPushState('on');
    } catch (err) {
      console.error('[pwa] push toggle failed', err);
    }
  };

  if (dismissed) return null;
  const showInstall = !!installEvt;
  const showPush = pushState === 'off';
  if (!showInstall && !showPush) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-xs z-50 rounded-xl border border-surface-border bg-surface-elevated p-3 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">Get the app experience</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-text-tertiary hover:text-text-primary"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-text-secondary mt-1">
        Install Free2Talk on your phone for full-screen rooms and notifications.
      </p>
      <div className="flex gap-2 mt-2.5">
        {showInstall && (
          <Button size="sm" onClick={handleInstall}>
            <Download className="h-4 w-4 mr-1.5" /> Install
          </Button>
        )}
        {showPush && (
          <Button size="sm" variant="outline" onClick={handlePushToggle}>
            <Bell className="h-4 w-4 mr-1.5" /> Notifications
          </Button>
        )}
      </div>
    </div>
  );
}
