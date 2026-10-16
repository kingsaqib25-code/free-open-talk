/**
 * Simple Event Emitter
 * 
 * A lightweight, type-safe event emitter for use in the voice service.
 * Follows the observer pattern for loose coupling between components.
 */

type EventMap = Record<string, (...args: any[]) => void>;

export class EventEmitter<T extends EventMap> {
    private listeners = new Map<keyof T, Set<T[keyof T]>>();

    /**
     * Subscribe to an event
     */
    on<K extends keyof T>(event: K, listener: T[K]): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);

        // Return unsubscribe function
        return () => this.off(event, listener);
    }

    /**
     * Subscribe to an event (one-time)
     */
    once<K extends keyof T>(event: K, listener: T[K]): () => void {
        const wrapper = ((...args: Parameters<T[K]>) => {
            this.off(event, wrapper as T[K]);
            (listener as (...args: any[]) => void)(...args);
        }) as T[K];

        return this.on(event, wrapper);
    }

    /**
     * Unsubscribe from an event
     */
    off<K extends keyof T>(event: K, listener: T[K]): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.delete(listener);
            if (eventListeners.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    /**
     * Emit an event to all listeners
     */
    emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.forEach((listener) => {
                try {
                    (listener as (...args: any[]) => void)(...args);
                } catch (error) {
                    console.error(`Error in event listener for "${String(event)}":`, error);
                }
            });
        }
    }

    /**
     * Remove all listeners for an event (or all events if no event specified)
     */
    removeAllListeners(event?: keyof T): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    /**
     * Get listener count for an event
     */
    listenerCount(event: keyof T): number {
        return this.listeners.get(event)?.size ?? 0;
    }
}
