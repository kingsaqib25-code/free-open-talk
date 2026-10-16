/**
 * Profile Content
 * 
 * Modern, minimalist profile page with responsive design.
 */

'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
    Card,
    CardContent,
    Avatar,
    Button,
    Badge,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    Skeleton,
} from '@/components/ui';
import {
    Settings,
    Edit2,
    Users,
    Clock,
    Globe,
    Calendar,
    ChevronRight,
    Phone,
    MessageSquare,
    TrendingUp,
    Mic,
    LogOut,
    Share2,
} from 'lucide-react';
import { cn } from '@/lib/design-system';
import { useProfile } from '@/lib/hooks/use-profile';
import { useAuthStore } from '@/lib/stores';
import { GoogleAccountSection } from '@/components/auth/google-one-tap';
import { isGoogleConfigured } from '@/lib/google-auth';
// import { EditProfileModal } from './edit-profile-modal';
import type { UserActivity, UserRoom } from '@/lib/services/profile.service';
import { EditProfileModal } from './edit-profile-modal';

//  Constants 

const LANGUAGE_FLAGS: Record<string, string> = {
    english: '🇺🇸',
    spanish: '🇪🇸',
    french: '🇫🇷',
    german: '🇩🇪',
    italian: '🇮🇹',
    portuguese: '🇵🇹',
    russian: '🇷🇺',
    japanese: '🇯🇵',
    korean: '🇰🇷',
    chinese: '🇨🇳',
    arabic: '🇸🇦',
    hindi: '🇮🇳',
    turkish: '🇹🇷',
    vietnamese: '🇻🇳',
    thai: '🇹🇭',
    dutch: '🇳🇱',
    polish: '🇵🇱',
    swedish: '🇸🇪',
    norwegian: '🇳🇴',
    danish: '🇩🇰',
    finnish: '🇫🇮',
    greek: '🇬🇷',
    czech: '🇨🇿',
    romanian: '🇷🇴',
    hungarian: '🇭🇺',
    ukrainian: '🇺🇦',
    indonesian: '🇮🇩',
    malay: '🇲🇾',
    tagalog: '🇵🇭',
    hebrew: '🇮🇱',
};

function getLanguageFlag(language: string): string {
    const key = language.toLowerCase().trim();
    return LANGUAGE_FLAGS[key] || '🌐';
}

// ------------------------ Main Component 

export function ProfileContent() {
    const { profile, activity, rooms, isLoading, error, refetch } = useProfile();
    const { logout } = useAuthStore();
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const handleLogout = useCallback(() => {
        logout();
        window.location.href = '/login';
    }, [logout]);

    if (isLoading) {
        return <ProfileSkeleton />;
    }

    if (error || !profile) {
        return (
            <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="text-6xl mb-4">😕</div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                    {error || 'Profile not found'}
                </h2>
                <p className="text-muted-foreground text-center mb-4">
                    There was a problem loading your profile.
                </p>
                <Button onClick={refetch}>Try Again</Button>
            </div>
        );
    }

    const { profile: userData, stats } = profile;

    return (
        <div className="space-y-6 pb-8">
            {/* Profile Header Card */}
            <Card className="overflow-hidden border-0 bg-linear-to-br from-primary-500/10 via-background to-background">
                <CardContent className="p-0">
                    {/* Banner */}
                    <div className="h-24 sm:h-32 bg-linear-to-r from-primary-600 via-primary-500 to-primary-400" />

                    {/* Profile Info */}
                    <div className="px-4 sm:px-6 pb-6">
                        {/* Avatar - overlapping banner */}
                        <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12 sm:-mt-16">
                            <Avatar
                                src={userData.avatarUrl ?? undefined}
                                fallback={userData.displayName || userData.username}
                                size="2xl"
                                className="w-24 h-24 sm:w-32 sm:h-32 border-4 border-background shadow-xl"
                            />

                            {/* Name & Actions */}
                            <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div>
                                    <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                                        {userData.displayName || userData.username}
                                    </h1>
                                    <p className="text-muted-foreground">@{userData.username}</p>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => setIsEditModalOpen(true)}
                                    >
                                        <Edit2 className="h-4 w-4 mr-1.5" />
                                        Edit Profile
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const url = `${window.location.origin}/u/${userData.username}`;
                                            navigator.clipboard.writeText(url);
                                        }}
                                        title="Copy profile link"
                                    >
                                        <Share2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        asChild
                                    >
                                        <Link href="/settings">
                                            <Settings className="h-4 w-4" />
                                        </Link>
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Bio */}
                        {userData.bio && (
                            <p className="mt-4 text-foreground/80 max-w-2xl">
                                {userData.bio}
                            </p>
                        )}

                        {/* Languages */}
                        <div className="mt-4 flex flex-wrap gap-4">
                            {userData.nativeLanguages && userData.nativeLanguages.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                        Native
                                    </span>
                                    {userData.nativeLanguages.map((lang) => (
                                        <Badge key={lang} variant="secondary" className="gap-1">
                                            {getLanguageFlag(lang)} {lang}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                            {userData.learningLanguages && userData.learningLanguages.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                        Learning
                                    </span>
                                    {userData.learningLanguages.map((lang) => (
                                        <Badge key={lang} variant="outline" className="gap-1">
                                            {getLanguageFlag(lang)} {lang}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Member Since */}
                        <div className="mt-4 flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            <span>Joined {formatDate(userData.createdAt)}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Google sync — one-tap sign in (guest-first: hidden when unconfigured) */}
            <GoogleSyncCard />

            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <StatCard
                    icon={<Clock className="h-5 w-5" />}
                    value={formatMinutes(stats.totalPracticeMinutes)}
                    label="Practice Time"
                    color="primary"
                />
                <StatCard
                    icon={<Users className="h-5 w-5" />}
                    value={stats.roomsJoined}
                    label="Rooms Joined"
                    color="blue"
                />
                <StatCard
                    icon={<Phone className="h-5 w-5" />}
                    value={stats.randomCallsCompleted}
                    label="Random Calls"
                    color="green"
                />
                <StatCard
                    icon={<Mic className="h-5 w-5" />}
                    value={stats.roomsCreated}
                    label="Rooms Created"
                    color="purple"
                />
            </div>

            {/* Tabs */}
            <Tabs defaultValue="activity" className="w-full">
                <TabsList className="w-full sm:w-auto grid grid-cols-3 sm:inline-flex">
                    <TabsTrigger value="activity" className="gap-1.5">
                        <TrendingUp className="h-4 w-4 hidden sm:inline" />
                        Activity
                    </TabsTrigger>
                    <TabsTrigger value="rooms" className="gap-1.5">
                        <MessageSquare className="h-4 w-4 hidden sm:inline" />
                        My Rooms
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="gap-1.5">
                        <Settings className="h-4 w-4 hidden sm:inline" />
                        Quick Settings
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="activity" className="mt-4">
                    <ActivitySection activity={activity} />
                </TabsContent>

                <TabsContent value="rooms" className="mt-4">
                    <RoomsSection rooms={rooms} />
                </TabsContent>

                <TabsContent value="settings" className="mt-4">
                    <QuickSettingsSection onLogout={handleLogout} />
                </TabsContent>
            </Tabs>

            {/* Edit Profile Modal */}
            <EditProfileModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                onSuccess={refetch}
            />
        </div>
    );
}

function GoogleSyncCard() {
    if (!isGoogleConfigured()) return null;
    return (
        <Card className="border-surface-border/50">
            <CardContent className="p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-foreground mb-1">
                    Sync across devices
                </h3>
                <p className="text-xs text-text-tertiary mb-3">
                    Link Google to keep your friends, followers and streaks on
                    every device. Guests keep working exactly as before.
                </p>
                <GoogleAccountSection />
            </CardContent>
        </Card>
    );
}

// ------------------------ Stat Card 

interface StatCardProps {
    icon: React.ReactNode;
    value: string | number;
    label: string;
    color?: 'primary' | 'blue' | 'green' | 'purple';
}

function StatCard({ icon, value, label, color = 'primary' }: StatCardProps) {
    const colorClasses = {
        primary: 'text-primary-500 bg-primary-500/10',
        blue: 'text-blue-500 bg-blue-500/10',
        green: 'text-green-500 bg-green-500/10',
        purple: 'text-purple-500 bg-purple-500/10',
    };

    return (
        <Card className="border-0 bg-card/50">
            <CardContent className="p-4 flex flex-col items-center text-center">
                <div className={cn('p-2.5 rounded-xl mb-2', colorClasses[color])}>
                    {icon}
                </div>
                <span className="text-2xl sm:text-3xl font-bold text-foreground">
                    {value}
                </span>
                <span className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                    {label}
                </span>
            </CardContent>
        </Card>
    );
}

// ------------------------ Activity Section 

interface ActivitySectionProps {
    activity: UserActivity[];
}

function ActivitySection({ activity }: ActivitySectionProps) {
    if (activity.length === 0) {
        return (
            <Card className="border-0 bg-card/50">
                <CardContent className="py-12 text-center">
                    <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground">No recent activity</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                        Join rooms or make calls to see your activity here
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-0 bg-card/50">
            <CardContent className="p-0 divide-y divide-border/50">
                {activity.map((item) => (
                    <ActivityItem key={item.id} activity={item} />
                ))}
            </CardContent>
        </Card>
    );
}

function ActivityItem({ activity }: { activity: UserActivity }) {
    const iconMap = {
        room_created: { icon: <MessageSquare className="h-4 w-4" />, color: 'bg-green-500/10 text-green-500' },
        room_joined: { icon: <Users className="h-4 w-4" />, color: 'bg-blue-500/10 text-blue-500' },
        random_call: { icon: <Phone className="h-4 w-4" />, color: 'bg-purple-500/10 text-purple-500' },
    };

    const config = iconMap[activity.type];

    const description = useMemo(() => {
        switch (activity.type) {
            case 'room_created':
                return <>Created room <span className="font-medium">{activity.data.roomName}</span></>;
            case 'room_joined':
                return <>Joined <span className="font-medium">{activity.data.roomName}</span></>;
            case 'random_call':
                const duration = activity.data.durationSeconds
                    ? formatDuration(activity.data.durationSeconds)
                    : 'Unknown';
                return (
                    <>
                        Random call
                        {activity.data.matchedLanguage && (
                            <Badge variant="outline" className="ml-2 text-xs">
                                {activity.data.matchedLanguage}
                            </Badge>
                        )}
                        <span className="text-muted-foreground ml-2">({duration})</span>
                    </>
                );
            default:
                return 'Activity';
        }
    }, [activity]);

    return (
        <div className="flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors">
            <div className={cn('p-2 rounded-lg', config.color)}>
                {config.icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate">{description}</div>
                <p className="text-xs text-muted-foreground">{formatRelativeTime(activity.timestamp)}</p>
            </div>
        </div>
    );
}

// ------------------------ Rooms Section 

interface RoomsSectionProps {
    rooms: UserRoom[];
}

function RoomsSection({ rooms }: RoomsSectionProps) {
    if (rooms.length === 0) {
        return (
            <Card className="border-0 bg-card/50">
                <CardContent className="py-12 text-center">
                    <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground">No rooms created yet</p>
                    <Button className="mt-4" asChild>
                        <Link href="/rooms/create">Create Your First Room</Link>
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-0 bg-card/50">
            <CardContent className="p-0 divide-y divide-border/50">
                {rooms.map((room) => (
                    <Link
                        key={room.id}
                        href={`/rooms/${room.slug || room.id}`}
                        className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group"
                    >
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="font-medium text-foreground truncate">{room.name}</h3>
                                <Badge variant={room.isActive ? 'success' : 'secondary'} className="text-xs">
                                    {room.isActive ? 'Active' : 'Closed'}
                                </Badge>
                            </div>
                            {room.topic && (
                                <p className="text-sm text-muted-foreground truncate mt-0.5">{room.topic}</p>
                            )}
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </Link>
                ))}
            </CardContent>
        </Card>
    );
}

// -------------------- Quick Settings Section 

interface QuickSettingsSectionProps {
    onLogout: () => void;
}

function QuickSettingsSection({ onLogout }: QuickSettingsSectionProps) {
    return (
        <Card className="border-0 bg-card/50">
            <CardContent className="p-0 divide-y divide-border/50">
                <SettingsLink
                    href="/settings"
                    icon={<Settings className="h-5 w-5" />}
                    label="Account Settings"
                />
                <SettingsLink
                    href="/settings/languages"
                    icon={<Globe className="h-5 w-5" />}
                    label="Language Preferences"
                />
                <SettingsLink
                    href="/settings/notifications"
                    icon={<MessageSquare className="h-5 w-5" />}
                    label="Notifications"
                />
                <button
                    onClick={onLogout}
                    className="w-full flex items-center justify-between p-4 hover:bg-destructive/10 transition-colors text-destructive"
                >
                    <div className="flex items-center gap-3">
                        <LogOut className="h-5 w-5" />
                        <span>Log Out</span>
                    </div>
                    <ChevronRight className="h-5 w-5" />
                </button>
            </CardContent>
        </Card>
    );
}

function SettingsLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
    return (
        <Link
            href={href}
            className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
        >
            <div className="flex items-center gap-3 text-foreground">
                <span className="text-muted-foreground">{icon}</span>
                <span>{label}</span>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
    );
}

// -------------------- Skeleton 

function ProfileSkeleton() {
    return (
        <div className="space-y-6">
            {/* Header skeleton */}
            <Card className="overflow-hidden border-0">
                <div className="h-24 sm:h-32 bg-muted animate-pulse" />
                <CardContent className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row gap-4 -mt-12 sm:-mt-16">
                        <Skeleton className="w-24 h-24 sm:w-32 sm:h-32 rounded-full" />
                        <div className="flex-1 space-y-3 pt-4">
                            <Skeleton className="h-8 w-48" />
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-16 w-full max-w-md" />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Stats skeleton */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                {[1, 2, 3, 4].map((i) => (
                    <Card key={i} className="border-0">
                        <CardContent className="p-4 flex flex-col items-center">
                            <Skeleton className="h-10 w-10 rounded-xl mb-2" />
                            <Skeleton className="h-8 w-16 mb-1" />
                            <Skeleton className="h-4 w-20" />
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Tabs skeleton */}
            <div className="space-y-4">
                <Skeleton className="h-10 w-full sm:w-80" />
                <Card className="border-0">
                    <CardContent className="p-4 space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center gap-3">
                                <Skeleton className="h-10 w-10 rounded-lg" />
                                <div className="flex-1 space-y-2">
                                    <Skeleton className="h-4 w-3/4" />
                                    <Skeleton className="h-3 w-1/4" />
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

// -------------------- Helpers 

function formatMinutes(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
