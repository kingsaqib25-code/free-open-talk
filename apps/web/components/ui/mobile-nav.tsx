'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/design-system';
import { Home, Users, MessageCircle, User, Plus, Heart } from './icons';

interface NavItem {
    href: string;
    label: string;
    icon: React.ReactNode;
}

const navItems: NavItem[] = [
    { href: '/', label: 'Rooms', icon: <Home className="h-5 w-5" /> },
    { href: '/random', label: 'Random', icon: <Users className="h-5 w-5" /> },
    { href: '/friends', label: 'Friends', icon: <Heart className="h-5 w-5" /> },
    { href: '/messages', label: 'Messages', icon: <MessageCircle className="h-5 w-5" /> },
    { href: '/profile', label: 'Profile', icon: <User className="h-5 w-5" /> },
];

export function MobileNav() {
    const pathname = usePathname();

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
            {/* Glassmorphism background */}
            <div className="absolute inset-0 bg-background-primary/80 backdrop-blur-xl border-t border-surface-border" />

            <div className="relative flex items-center justify-around px-2 py-2 safe-area-bottom">
                {navItems.map((item) => {
                    const isActive = pathname === item.href;

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                'flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl transition-all duration-200',
                                isActive
                                    ? 'text-primary-400'
                                    : 'text-text-tertiary hover:text-text-secondary'
                            )}
                        >
                            <div className={cn(
                                'transition-transform duration-200',
                                isActive && 'scale-110'
                            )}>
                                {item.icon}
                            </div>
                            <span className="text-[10px] font-medium">{item.label}</span>
                            {isActive && (
                                <div className="absolute -bottom-0.5 h-1 w-8 rounded-full bg-primary-500" />
                            )}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}

// Floating Action Button for creating rooms
export function FloatingActionButton() {
    return (
        <Link
            href="/rooms/create"
            className={cn(
                'fixed bottom-20 right-4 z-40 md:hidden',
                'flex h-14 w-14 items-center justify-center rounded-full',
                'bg-gradient-to-r from-primary-500 to-primary-600',
                'shadow-lg shadow-primary-500/30',
                'transition-all duration-200',
                'hover:scale-105 hover:shadow-primary-500/50',
                'active:scale-95'
            )}
        >
            <Plus className="h-6 w-6 text-white" />
        </Link>
    );
}
