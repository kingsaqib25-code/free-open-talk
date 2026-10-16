'use client';

/**
 * Create-room form — Convex edition.
 * No login wall: the creator is identified by guest nickname + deviceId.
 * Validation mirrors convex/rooms.ts (name ≤80, topic ≤120, nickname ≤30).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Card,
    Button,
    Input,
    LanguageBadge,
} from '@/components/ui';
import {
    Globe,
    Users,
    Mic,
    Monitor,
} from '@/components/ui/icons';
import { cn } from '@/lib/design-system';
import { useCreateRoom } from '@/lib/hooks/use-convex-rooms';
import { getNickname, setNickname, randomNickname } from '@/lib/guest';

const availableLanguages = [
    'English', 'Spanish', 'French', 'German', 'Japanese',
    'Korean', 'Chinese', 'Portuguese', 'Russian', 'Italian',
    'Arabic', 'Hindi', 'Urdu', 'Dutch', 'Swedish', 'Polish',
];

type RoomMode = 'voice' | 'stage' | 'private';

const MODES: Array<{
    id: RoomMode;
    label: string;
    description: string;
    maxNote: string;
}> = [
    {
        id: 'voice',
        label: 'Voice Room',
        description: 'Open voice chat, great for speaking practice',
        maxNote: 'Up to 25 people',
    },
    {
        id: 'stage',
        label: 'Stage',
        description: 'Group video — host picks who can speak',
        maxNote: 'Up to 8 people',
    },
    {
        id: 'private',
        label: 'Private 1-on-1',
        description: 'Video + screen share with one partner',
        maxNote: 'Just 2 people',
    },
];

export function CreateRoomContent() {
    const router = useRouter();
    const createRoom = useCreateRoom();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        nickname: getNickname() || randomNickname(),
        name: '',
        topic: '',
        language: 'English',
        mode: 'voice' as RoomMode,
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (!formData.nickname.trim()) {
            newErrors.nickname = 'Pick a nickname so others know who you are';
        } else if (formData.nickname.trim().length > 30) {
            newErrors.nickname = 'Nickname must be 30 characters or less';
        }

        if (!formData.name.trim()) {
            newErrors.name = 'Room name is required';
        } else if (formData.name.trim().length < 3) {
            newErrors.name = 'Room name must be at least 3 characters';
        } else if (formData.name.trim().length > 80) {
            newErrors.name = 'Room name must be 80 characters or less';
        }

        if (formData.topic && formData.topic.length > 120) {
            newErrors.topic = 'Topic must be 120 characters or less';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validate()) return;

        setIsSubmitting(true);
        setErrors({});

        try {
            const nickname = formData.nickname.trim();
            // Persist the nickname for future joins.
            setNickname(nickname);

            const roomId = await createRoom({
                name: formData.name.trim(),
                language: formData.language,
                topic: formData.topic.trim() || undefined,
                mode: formData.mode,
                nickname,
            });

            if (!roomId) {
                throw new Error('No room ID returned');
            }

            // Redirect to the created room.
            router.push(`/rooms/${roomId}`);
        } catch (error: any) {
            console.error('Failed to create room:', error);
            setErrors({
                submit: error?.message || 'Failed to create room. Please try again.',
            });
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 py-4">
            {/* Nickname */}
            <Card>
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary-400" />
                        <h3 className="font-medium text-text-primary">Your Nickname</h3>
                    </div>

                    <Input
                        label="Nickname"
                        placeholder="How should others call you?"
                        value={formData.nickname}
                        onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
                        error={errors.nickname}
                        helperText="No sign-up needed — this name is saved on your device."
                        maxLength={30}
                    />
                </div>
            </Card>

            {/* Room Details */}
            <Card>
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Mic className="h-5 w-5 text-primary-400" />
                        <h3 className="font-medium text-text-primary">Room Details</h3>
                    </div>

                    <Input
                        label="Room Name"
                        placeholder="Give your room a name..."
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        error={errors.name}
                        maxLength={80}
                    />

                    <Input
                        label="Topic (optional)"
                        placeholder="What will you be discussing?"
                        value={formData.topic}
                        onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                        error={errors.topic}
                        helperText={`${formData.topic.length}/120`}
                        maxLength={120}
                    />
                </div>
            </Card>

            {/* Language */}
            <Card>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Globe className="h-5 w-5 text-primary-400" />
                            <h3 className="font-medium text-text-primary">Language</h3>
                        </div>
                        <span className="text-xs text-text-tertiary">
                            {formData.language}
                        </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {availableLanguages.map((lang) => {
                            const isSelected = formData.language === lang;
                            return (
                                <button
                                    key={lang}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, language: lang })}
                                    className={cn(
                                        'px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
                                        isSelected
                                            ? 'bg-primary-500 text-white'
                                            : 'bg-surface-hover text-text-secondary hover:text-text-primary'
                                    )}
                                >
                                    {lang}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </Card>

            {/* Room Mode */}
            <Card>
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Monitor className="h-5 w-5 text-primary-400" />
                        <h3 className="font-medium text-text-primary">Room Mode</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {MODES.map((mode) => {
                            const isSelected = formData.mode === mode.id;
                            return (
                                <button
                                    key={mode.id}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, mode: mode.id })}
                                    className={cn(
                                        'p-3 rounded-xl text-left transition-all duration-200 border',
                                        isSelected
                                            ? 'bg-primary-500/10 border-primary-500 text-text-primary'
                                            : 'bg-surface-hover border-transparent text-text-secondary hover:text-text-primary'
                                    )}
                                >
                                    <p className="text-sm font-semibold">{mode.label}</p>
                                    <p className="text-xs mt-1 opacity-80">{mode.description}</p>
                                    <p className="text-xs mt-1 font-medium">{mode.maxNote}</p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </Card>

            {/* Preview */}
            <Card variant="gradient">
                <h4 className="text-sm font-medium text-text-secondary mb-3">Preview</h4>
                <div className="space-y-2">
                    <p className="text-lg font-semibold text-text-primary">
                        {formData.name || 'Your Room Name'}
                    </p>
                    {formData.topic && (
                        <p className="text-sm text-text-secondary">{formData.topic}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-2">
                        <LanguageBadge language={formData.language} size="sm" />
                    </div>
                    <p className="text-xs text-text-tertiary pt-1">
                        Hosted by {formData.nickname || 'you'}
                    </p>
                </div>
            </Card>

            {/* Submit Error */}
            {errors.submit && (
                <div className="p-3 rounded-lg bg-status-error/10 border border-status-error/20">
                    <p className="text-sm text-status-error">{errors.submit}</p>
                </div>
            )}

            {/* Submit */}
            <Button
                type="submit"
                size="lg"
                isLoading={isSubmitting}
            >
                <Mic className="h-5 w-5" />
                Create Room
            </Button>
        </form>
    );
}
