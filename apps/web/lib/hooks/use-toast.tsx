'use client';

import { useCallback } from 'react';
import { toast as sonnerToast, Toaster as SonnerToaster } from 'sonner';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
    title?: string;
    description?: string;
    duration?: number;
    action?: {
        label: string;
        onClick: () => void;
    };
}

// Re-export Toaster component with our styling
export function Toaster() {
    return (
        <SonnerToaster
            position="top-right"
            toastOptions={{
                classNames: {
                    toast: 'bg-surface-default border border-surface-border shadow-xl rounded-xl backdrop-blur-none',
                    title: 'text-text-primary font-medium',
                    description: 'text-text-secondary text-sm',
                    actionButton: 'bg-primary-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-500',
                    cancelButton: 'bg-surface-hover text-text-secondary px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-surface-active',
                    closeButton: 'text-text-tertiary hover:text-text-primary',
                    success: 'border-l-4 border-l-emerald-500',
                    error: 'border-l-4 border-l-red-500',
                    warning: 'border-l-4 border-l-amber-500',
                    info: 'border-l-4 border-l-status-info',
                },
            }}
            expand={false}
            richColors={false}
        />
    );
}

// Toast utility functions
export const toast = {
    success: (message: string, options?: ToastOptions) => {
        sonnerToast.success(options?.title || message, {
            description: options?.title ? message : options?.description,
            duration: options?.duration ?? 4000,
            action: options?.action ? {
                label: options.action.label,
                onClick: options.action.onClick,
            } : undefined,
        });
    },

    error: (message: string, optionsOrDescription?: ToastOptions | string) => {
        const options = typeof optionsOrDescription === 'string'
            ? { description: optionsOrDescription }
            : optionsOrDescription;

        sonnerToast.error(options?.title || message, {
            description: options?.title ? message : options?.description,
            duration: options?.duration ?? 5000,
            action: options?.action ? {
                label: options.action.label,
                onClick: options.action.onClick,
            } : undefined,
        });
    },

    warning: (message: string, options?: ToastOptions) => {
        sonnerToast.warning(options?.title || message, {
            description: options?.title ? message : options?.description,
            duration: options?.duration ?? 4000,
            action: options?.action ? {
                label: options.action.label,
                onClick: options.action.onClick,
            } : undefined,
        });
    },

    info: (message: string, options?: ToastOptions) => {
        sonnerToast.info(options?.title || message, {
            description: options?.title ? message : options?.description,
            duration: options?.duration ?? 4000,
            action: options?.action ? {
                label: options.action.label,
                onClick: options.action.onClick,
            } : undefined,
        });
    },

    promise: <T,>(
        promise: Promise<T>,
        options: {
            loading: string;
            success: string | ((data: T) => string);
            error: string | ((error: Error) => string);
        }
    ) => {
        return sonnerToast.promise(promise, {
            loading: options.loading,
            success: options.success,
            error: options.error,
        });
    },

    dismiss: (toastId?: string | number) => {
        sonnerToast.dismiss(toastId);
    },

    // Room-specific toast messages
    room: {
        joined: (roomName: string) =>
            toast.success(`Joined "${roomName}"`, { description: 'You are now in the voice room' }),

        left: () =>
            toast.info('Left the room'),

        full: () =>
            toast.error('Room is full', { description: 'This room has reached its maximum capacity' }),

        kicked: (reason?: string) =>
            toast.error('You were kicked from the room', {
                description: reason || 'The room owner removed you from the room'
            }),

        closed: (reason?: string) =>
            toast.warning('Room closed', { description: reason || 'The room owner closed this room' }),

        ownerLeft: () =>
            toast.info('Room owner left', { description: 'Ownership has been transferred' }),

        newOwner: (name: string) =>
            toast.info(`${name} is now the room owner`),

        userJoined: (name: string) =>
            toast.info(`${name} joined the room`),

        userLeft: (name: string) =>
            toast.info(`${name} left the room`),

        connectionError: () =>
            toast.error('Connection error', {
                description: 'Failed to connect to voice. Please try again.',
                action: { label: 'Retry', onClick: () => window.location.reload() }
            }),

        microphoneError: () =>
            toast.error('Microphone access denied', {
                description: 'Please allow microphone access to use voice chat'
            }),

        alreadyInRoom: () =>
            toast.warning('Already in a room', {
                description: 'Please leave your current room first'
            }),

        created: (roomName: string) =>
            toast.success(`Room "${roomName}" created!`),
    },
};

// Hook for using toast in components
export function useToast() {
    const showToast = useCallback((type: ToastType, message: string, options?: ToastOptions) => {
        toast[type](message, options);
    }, []);

    return {
        toast: showToast,
        success: toast.success,
        error: toast.error,
        warning: toast.warning,
        info: toast.info,
        promise: toast.promise,
        dismiss: toast.dismiss,
        room: toast.room,
    };
}
