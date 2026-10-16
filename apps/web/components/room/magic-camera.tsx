'use client';

/**
 * Magic Camera — fun local camera filters.
 *
 * A tiny module-level store (no provider needed) exposing useCameraFilter():
 *   const { filter, setFilter } = useCameraFilter();
 *
 * Filters render as CSS `filter` on the self VideoTile only — pure local
 * preview; peers receive the raw camera feed. The picker labels this honestly.
 */
import { useSyncExternalStore, useCallback } from 'react';
import { cn } from '@/lib/design-system';

export type CameraFilterId = 'none' | 'warm' | 'noir' | 'soft';

export const CAMERA_FILTERS: Record<
    CameraFilterId,
    { label: string; css: string; hint: string }
> = {
    none: { label: 'Normal', css: '', hint: 'No filter' },
    warm: {
        label: 'Warm',
        css: 'sepia(0.45) saturate(1.35) contrast(1.03)',
        hint: 'Cozy café glow',
    },
    noir: {
        label: 'Noir',
        css: 'grayscale(1) contrast(1.12) brightness(1.02)',
        hint: 'Black & white',
    },
    soft: {
        label: 'Soft',
        css: 'brightness(1.08) saturate(1.05) blur(0.6px)',
        hint: 'Gentle soft-focus',
    },
};

export const CAMERA_FILTER_ORDER: CameraFilterId[] = ['none', 'warm', 'noir', 'soft'];

// --- external store -------------------------------------------------------

let currentFilter: CameraFilterId = 'none';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot(): CameraFilterId {
    return currentFilter;
}

function getServerSnapshot(): CameraFilterId {
    return 'none';
}

/** Returns { filter, setFilter } — works anywhere, no provider required. */
export function useCameraFilter(): {
    filter: CameraFilterId;
    setFilter: (f: CameraFilterId) => void;
} {
    const filter = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    const setFilter = useCallback((f: CameraFilterId) => {
        if (currentFilter === f) return;
        currentFilter = f;
        for (const l of listeners) l();
    }, []);
    return { filter, setFilter };
}

/** CSS filter string for a filter id ('' for none). */
export function cameraFilterCss(filter: CameraFilterId): string {
    return CAMERA_FILTERS[filter]?.css ?? '';
}

// --- picker UI ------------------------------------------------------------

/** Swatch buttons for each filter. Pure client component. */
export function CameraFilterPicker() {
    const { filter, setFilter } = useCameraFilter();
    return (
        <div>
            <div className="grid grid-cols-4 gap-2">
                {CAMERA_FILTER_ORDER.map((id) => {
                    const def = CAMERA_FILTERS[id];
                    const active = filter === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setFilter(id)}
                            aria-pressed={active}
                            className={cn(
                                'rounded-xl border px-2 py-3 text-center transition-colors',
                                active
                                    ? 'border-primary-500 bg-primary-500/15 ring-1 ring-primary-500/50'
                                    : 'border-surface-border bg-surface-default hover:bg-surface-hover'
                            )}
                        >
                            <span
                                className="mx-auto mb-1.5 block h-10 w-10 rounded-full"
                                style={{
                                    background:
                                        'linear-gradient(135deg, #f97316 0%, #f59e0b 55%, #7c2d12 100%)',
                                    filter: def.css || undefined,
                                }}
                                aria-hidden
                            />
                            <span className="block text-xs font-medium text-text-primary">
                                {def.label}
                            </span>
                            <span className="block text-[10px] text-text-tertiary">
                                {def.hint}
                            </span>
                        </button>
                    );
                })}
            </div>
            <p className="mt-3 text-xs text-text-tertiary leading-relaxed">
                Preview only — you see the filter on your own tile; everyone
                else sees your normal camera feed.
            </p>
        </div>
    );
}
