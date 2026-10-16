/**
 * Icon Components - Free2Talk
 * 
 * Consistent icon wrapper using Lucide React
 */

import { forwardRef, type SVGAttributes } from 'react';
import {
    Mic,
    MicOff,
    Phone,
    PhoneOff,
    Users,
    User,
    Settings,
    Search,
    Plus,
    X,
    Menu,
    Home,
    MessageCircle,
    Globe,
    Volume2,
    VolumeX,
    ChevronRight,
    ChevronLeft,
    ChevronDown,
    ChevronUp,
    LogOut,
    LogIn,
    Bell,
    Heart,
    Star,
    Crown,
    Shield,
    Check,
    AlertCircle,
    Info,
    Loader2,
    MoreHorizontal,
    MoreVertical,
    Copy,
    Share2,
    ExternalLink,
    Edit,
    Trash2,
    Eye,
    EyeOff,
    Lock,
    Unlock,
    RefreshCw,
    Filter,
    SortAsc,
    SortDesc,
    Calendar,
    Clock,
    MapPin,
    Flag,
    Bookmark,
    Send,
    Image,
    Smile,
    Wifi,
    WifiOff,
    UserPlus,
    UserMinus,
    Video,
    VideoOff,
    // New icons for redesigned room UI
    Monitor,
    MonitorOff,
    Grid3X3,
    Maximize2,
    Signal,
    SignalHigh,
    SignalMedium,
    SignalLow,
    SignalZero,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/design-system';

// Re-export commonly used icons
export {
    Mic,
    MicOff,
    Phone,
    PhoneOff,
    Users,
    User,
    Settings,
    Search,
    Plus,
    X,
    Menu,
    Home,
    MessageCircle,
    Globe,
    Volume2,
    VolumeX,
    ChevronRight,
    ChevronLeft,
    ChevronDown,
    ChevronUp,
    LogOut,
    LogIn,
    Bell,
    Heart,
    Star,
    Crown,
    Shield,
    Check,
    AlertCircle,
    Info,
    Loader2,
    MoreHorizontal,
    MoreVertical,
    Copy,
    Share2,
    ExternalLink,
    Edit,
    Trash2,
    Eye,
    EyeOff,
    Lock,
    Unlock,
    RefreshCw,
    Filter,
    SortAsc,
    SortDesc,
    Calendar,
    Clock,
    MapPin,
    Flag,
    Bookmark,
    Send,
    Image,
    Smile,
    Wifi,
    WifiOff,
    UserPlus,
    UserMinus,
    Video,
    VideoOff,
    // New icons for redesigned room UI
    Monitor,
    MonitorOff,
    Grid3X3,
    Maximize2,
    Signal,
    SignalHigh,
    SignalMedium,
    SignalLow,
    SignalZero,
};

// Icon wrapper component with consistent sizing
interface IconProps extends SVGAttributes<SVGElement> {
    icon: LucideIcon;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const iconSizes = {
    xs: 'h-3 w-3',
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
    xl: 'h-8 w-8',
};

const Icon = forwardRef<SVGSVGElement, IconProps>(
    ({ icon: IconComponent, size = 'md', className, ...props }, ref) => {
        return (
            <IconComponent
                ref={ref}
                className={cn(iconSizes[size], className)}
                {...props}
            />
        );
    }
);

Icon.displayName = 'Icon';

// Custom Room icon
const RoomIcon = forwardRef<SVGSVGElement, SVGAttributes<SVGElement>>(
    ({ className, ...props }, ref) => (
        <svg
            ref={ref}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('h-5 w-5', className)}
            {...props}
        >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <circle cx="12" cy="13" r="3" />
            <path d="M12 10v0" />
        </svg>
    )
);

RoomIcon.displayName = 'RoomIcon';

// Voice wave icon for speaking indicator
const VoiceWaveIcon = forwardRef<SVGSVGElement, SVGAttributes<SVGElement>>(
    ({ className, ...props }, ref) => (
        <svg
            ref={ref}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={cn('h-5 w-5', className)}
            {...props}
        >
            <rect x="4" y="10" width="2" height="4" rx="1" className="animate-[soundWave_0.6s_ease-in-out_infinite]" />
            <rect x="8" y="7" width="2" height="10" rx="1" className="animate-[soundWave_0.6s_ease-in-out_infinite_0.1s]" />
            <rect x="12" y="4" width="2" height="16" rx="1" className="animate-[soundWave_0.6s_ease-in-out_infinite_0.2s]" />
            <rect x="16" y="7" width="2" height="10" rx="1" className="animate-[soundWave_0.6s_ease-in-out_infinite_0.3s]" />
            <rect x="20" y="10" width="2" height="4" rx="1" className="animate-[soundWave_0.6s_ease-in-out_infinite_0.4s]" />
        </svg>
    )
);

VoiceWaveIcon.displayName = 'VoiceWaveIcon';

// Spinner/Loading icon
const SpinnerIcon = forwardRef<SVGSVGElement, SVGAttributes<SVGElement>>(
    ({ className, ...props }, ref) => (
        <Loader2
            ref={ref}
            className={cn('h-5 w-5 animate-spin', className)}
            {...props}
        />
    )
);

SpinnerIcon.displayName = 'SpinnerIcon';

export { Icon, RoomIcon, VoiceWaveIcon, SpinnerIcon };
export type { LucideIcon };
