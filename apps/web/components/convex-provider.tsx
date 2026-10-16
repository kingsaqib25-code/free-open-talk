'use client';

import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { useState, type ReactNode } from 'react';

/**
 * Convex provider. Renders children WITHOUT Convex when NEXT_PUBLIC_CONVEX_URL
 * is not configured yet (so the app shell still builds/renders pre-provisioning).
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          '[talkfree] NEXT_PUBLIC_CONVEX_URL not set — Convex hooks will throw until configured. Run `npx convex dev` to provision.'
        );
      }
      return null;
    }
    return new ConvexReactClient(url);
  });

  if (!client) return <>{children}</>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
