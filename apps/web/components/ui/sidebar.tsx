'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/design-system';
import { Button } from './button';
import { Avatar } from './avatar';
import { SearchInput } from './input';
import {
    Home,
    Users,
    MessageCircle,
    User,
    Settings,
    Plus,
    ChevronLeft,
    ChevronRight,
    LogOut,
    ChevronDown,
} from './icons';
import { useState, useEffect, memo, useCallback } from 'react';
import { useAuthStore, selectIsAuthenticated, selectUser } from '@/lib/stores';
import { UserMenu } from '../auth';
import { AuthenticatedMenu } from '../auth/user-menu';
import { useAuth } from '@/lib/hooks';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './primitives';
import Image from 'next/image';

interface NavItem {
    href: string;
    label: string;
    icon: React.ReactNode;
    badge?: number;
}

const mainNavItems: NavItem[] = [
    { href: '/', label: 'Voice Rooms', icon: <Home className="h-5 w-5" /> },
    { href: '/random', label: 'Random Match', icon: <Users className="h-5 w-5" /> },
    { href: '/messages', label: 'Messages', icon: <MessageCircle className="h-5 w-5" /> },
];

// Custom hook for sidebar state persistence
function useSidebarState() {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved !== null) {
            setIsCollapsed(saved === 'true');
        }
        setIsInitialized(true);
    }, []);

    // Only dispatch events after initial mount
    useEffect(() => {
        if (isInitialized) {
            window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed: isCollapsed } }));
        }
    }, [isCollapsed, isInitialized]);

    const toggle = () => {
        setIsCollapsed(prev => {
            const newValue = !prev;
            localStorage.setItem('sidebar-collapsed', String(newValue));
            return newValue;
        });
    };

    return { isCollapsed, toggle };
}

export function Sidebar() {
    const pathname = usePathname();
    const { isCollapsed, toggle } = useSidebarState();
    const isAuthenticated = useAuthStore(selectIsAuthenticated);
    const user = useAuthStore(selectUser);

    return (
        <aside
            className={cn(
                'hidden md:flex flex-col fixed left-0 top-0 bottom-0 z-40',
                'bg-gradient-to-b from-background-secondary to-background-secondary/95',
                'border-r border-surface-border/50',
                'transition-all duration-300 ease-in-out',
                'shadow-lg shadow-black/5',
                isCollapsed ? 'w-16' : 'w-64'
            )}
        >
            {/* Logo & Brand */}
            <div className={cn(
                "flex items-center justify-between h-14 px-4 border-b border-surface-border/50",
                isCollapsed && "px-0"
            )}>
                {!isCollapsed ? (
                    <Link href="/" className="flex items-center gap-3 group">
                        {/* <div className="h-9 w-9 rounded-xl from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/30 group-hover:scale-105 transition-transform"> */}
                        <div>
                            <Image
                                src="/white-logo.png"
                                alt="Free Open Talk Logo"
                                width={74}
                                height={74}
                                priority
                                placeholder="empty"
                                onLoadingComplete={() => { }}
                                className='fill-white'
                            />
                            <noscript>
                                <span className="text-white font-bold text-base">F2T</span>
                            </noscript>
                        </div>
                        <span className="font-bold text-lg text-text-primary">Free Open Talk</span>
                    </Link>
                ) : (
                    <Link href="/" className="mx-auto group">
                        {/* <div className="h-9 w-9 rounded-xl from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/30 group-hover:scale-105 transition-transform"> */}
                        <div>
                            {/* <span className="text-white font-bold text-base">F2T</span> */}
                            <Image
                                src="/white-logo.png"
                                alt="Free Open Talk Logo"
                                width={74}
                                height={74}
                                className="fill-white"
                            />
                        </div>
                    </Link>
                )}
            </div>

            {/* Toggle Button - Floating Style */}
            <button
                onClick={toggle}
                className={cn(
                    'absolute -right-3 top-20 z-50',
                    'w-6 h-6 rounded-full',
                    'bg-background-secondary border border-surface-border',
                    'flex items-center justify-center',
                    'shadow-md hover:shadow-lg',
                    'text-text-secondary hover:text-text-primary',
                    'transition-all duration-200 hover:scale-110'
                )}
                aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                    <ChevronLeft className="h-3.5 w-3.5" />
                )}
            </button>

            {/* Search - Hidden when collapsed */}
            {!isCollapsed && (
                <div className="p-4">
                    <SearchInput placeholder="Search rooms..." className="bg-background-tertiary/50" />
                </div>
            )}

            {/* Create Room Button */}
            <div className={cn('px-4 py-2', isCollapsed && 'px-3')}>
                <Button
                    size={isCollapsed ? 'icon' : 'md'}
                    className={cn(
                        'bg-gradient-to-r from-primary-500 to-primary-600',
                        'hover:from-primary-400 hover:to-primary-500',
                        'shadow-md hover:shadow-lg hover:shadow-primary-500/25',
                        'transition-all duration-200',
                        !isCollapsed && 'w-full',
                        isCollapsed && 'w-11 h-11 mx-auto'
                    )}
                    asChild
                >
                    <Link href="/rooms/create">
                        <Plus className="h-5 w-5" />
                        {!isCollapsed && <span className="ml-2">Create Room</span>}
                    </Link>
                </Button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 md:px-3 py-4 space-y-1.5 overflow-y-auto">
                {mainNavItems.map((item) => {
                    const isActive = pathname === item.href;

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                'flex items-center gap-3 px-3 py-2.5 rounded-xl',
                                'transition-all duration-200 group relative',
                                isActive
                                    ? 'bg-primary-500/10 text-primary-400 shadow-sm'
                                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                                isCollapsed && 'justify-center px-2'
                            )}
                            title={isCollapsed ? item.label : undefined}
                        >
                            <div className={cn(
                                'flex items-center justify-center',
                                isActive && 'text-primary-400',
                                !isActive && 'text-text-secondary group-hover:text-text-primary'
                            )}>
                                {item.icon}
                            </div>
                            {!isCollapsed && (
                                <>
                                    <span className="font-medium flex-1">{item.label}</span>
                                    {item.badge && (
                                        <span className="bg-primary-500 text-white text-xs px-2 py-0.5 rounded-full font-semibold">
                                            {item.badge}
                                        </span>
                                    )}
                                </>
                            )}
                            {/* Active indicator */}
                            {/* {isActive && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-500 rounded-r-full" />
                            )} */}
                        </Link>
                    );
                })}
            </nav>

            {/* User Section */}
            <div className="p-1.5 border-t border-surface-border/50">
                {isAuthenticated && user ? (
                    <div className="space-y-2">
                        <div className={cn(
                            'flex items-center gap-3 p-2 rounded-xl',
                            'hover:bg-surface-hover transition-colors',
                            isCollapsed && 'justify-center p-0'
                        )}>
                            <Link href="/profile" className={isCollapsed ? '' : 'flex items-center gap-3 flex-1'}>
                                <Avatar
                                    src={user.avatarUrl ?? undefined}
                                    alt={user.displayName || user.username}
                                    fallback={user.displayName || user.username}
                                    size="md"
                                    status="online"
                                    showStatus
                                    className="ring-2 ring-primary-500/20"
                                />
                                {!isCollapsed && (
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-foreground truncate">
                                            {user.displayName || user.username}
                                        </p>
                                        <p className="text-xs text-muted-foreground truncate">
                                            @{user.username}
                                        </p>
                                    </div>
                                )}
                            </Link>
                            {!isCollapsed && (
                                <SettingsCollapseMenu />
                            )}
                        </div>
                    </div>
                ) : (
                    <Button
                        variant="secondary"
                        size={isCollapsed ? 'icon' : 'md'}
                        className={cn(
                            'bg-primary-500/10 text-primary-400',
                            'hover:bg-primary-500/20',
                            'border border-primary-500/20',
                            !isCollapsed && 'w-full'
                        )}
                        asChild
                    >
                        <Link href="/login">
                            {isCollapsed ? <User className="h-5 w-5" /> : 'Sign In'}
                        </Link>
                    </Button>
                )}
            </div>
        </aside>
    );
}


export const SettingsCollapseMenu = memo(function SettingsCollapseMenu() {
    const { user, logout, isLoading } = useAuth();

    const handleLogout = useCallback(async () => {
        try {
            await logout();
        } catch (error) {
            console.error('Logout error:', error);
        }
    }, [logout]);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 px-2 cursor-pointer">
                    <Settings className="h-4 w-4 " />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user?.displayName || user?.username}</p>
                        <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link href="/profile" className="cursor-pointer">
                        <User className="mr-2 h-4 w-4" />
                        Profile
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href="/settings" className="cursor-pointer">
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={handleLogout}
                    disabled={isLoading}
                    className="cursor-pointer text-danger-500 focus:text-danger-500"
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    {isLoading ? 'Signing out...' : 'Sign out'}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
});