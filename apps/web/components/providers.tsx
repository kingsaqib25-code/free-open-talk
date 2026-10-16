'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ThemeProvider } from '@/lib/design-system/theme';
import { AuthProvider } from '@/components/auth-provider';
import { GoogleAuthProvider } from '@/components/auth/google-auth-provider';
import { ConvexClientProvider } from '@/components/convex-provider';

export function Providers({ children }: { children: ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 60 * 1000,
                        refetchOnWindowFocus: false,
                        retry: 1,
                    },
                    mutations: {
                        retry: 0,
                    },
                },
            })
    );

    return (
        <ConvexClientProvider>
            <QueryClientProvider client={queryClient}>
                <ThemeProvider defaultTheme="dark" enableSystem={false}>
                    <GoogleAuthProvider>
                        <AuthProvider>{children}</AuthProvider>
                    </GoogleAuthProvider>
                </ThemeProvider>
            </QueryClientProvider>
        </ConvexClientProvider>
    );
}
