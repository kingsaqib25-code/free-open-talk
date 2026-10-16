'use client';

import Link from 'next/link';
import { cn } from '@/lib/design-system';
import { Button } from './button';
import { Bell, Plus } from './icons';
import { UserMenu } from '@/components/auth';
import Image from 'next/image';

interface HeaderProps {
    title?: string;
    showCreateButton?: boolean;
}

export function Header({ title = 'Voice Rooms', showCreateButton = true }: HeaderProps) {
    return (
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-surface-border">
            <div className="flex items-center justify-between h-14 px-4 md:px-6">
                {/* Logo - Mobile only */}
                <div className="flex items-center gap-3 md:hidden">
                    <Link href="/" className="flex items-center gap-2">
                        {/* <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center"> */}
                        <div>
                            {/* <span className="text-white font-bold text-sm">F2T</span> */}
                            <Image
                                src="/white-logo.png"
                                alt="Free Open Talk Logo"
                                width={74}
                                height={74}
                            // className="h-6 w-6"
                            />
                        </div>
                    </Link>
                </div>

                {/* Title - Desktop */}
                <h1 className="hidden md:block text-xl font-semibold text-foreground">
                    {title}
                </h1>

                {/* Right Section */}
                <div className="flex items-center gap-2">
                    {/* Create Room - Desktop */}
                    {showCreateButton && (
                        <Button
                            size="sm"
                            className="hidden md:flex"
                            asChild
                        >
                            <Link href="/rooms/create">
                                <Plus className="h-4 w-4" />
                                <span>Create Room</span>
                            </Link>
                        </Button>
                    )}

                    {/* Notifications */}
                    <button className="relative p-2 rounded-lg hover:bg-surface-hover text-muted-foreground transition-colors">
                        <Bell className="h-5 w-5" />
                        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary-500" />
                    </button>

                    {/* User Menu */}
                    <UserMenu />
                </div>
            </div>
        </header>
    );
}

// Simple header for pages that don't need the full header
interface SimpleHeaderProps {
    title: string;
    backHref?: string;
    rightAction?: React.ReactNode;
}

export function SimpleHeader({ title, backHref, rightAction }: SimpleHeaderProps) {
    return (
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-surface-border">
            <div className="flex items-center justify-between h-14 px-4">
                <div className="flex items-center gap-3">
                    {backHref && (
                        <Link
                            href={backHref}
                            className="p-2 -ml-2 rounded-lg hover:bg-surface-hover text-muted-foreground transition-colors"
                        >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </Link>
                    )}
                    <h1 className="text-lg font-semibold text-foreground">{title}</h1>
                </div>
                {rightAction}
            </div>
        </header>
    );
}
