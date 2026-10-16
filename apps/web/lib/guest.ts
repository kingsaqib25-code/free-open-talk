'use client';

/**
 * Guest identity — no login wall for MVP.
 * deviceId: stable random ID per browser (the "user" for presence/moderation).
 * nickname: chosen at join time, persisted.
 */

const DEVICE_KEY = 'talkfree_device_id';
const NICKNAME_KEY = 'talkfree_nickname';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getNickname(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(NICKNAME_KEY);
}

export function setNickname(name: string): void {
  localStorage.setItem(NICKNAME_KEY, name.trim().slice(0, 30));
}

/** Fun default nicknames for one-tap guest join. */
const ADJECTIVES = ['Swift', 'Bright', 'Calm', 'Bold', 'Kind', 'Quick', 'Warm', 'Sharp'];
const ANIMALS = ['Fox', 'Owl', 'Bear', 'Wolf', 'Hawk', 'Deer', 'Seal', 'Crow'];

export function randomNickname(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const n = Math.floor(Math.random() * 99) + 1;
  return `${a}${b}${n}`;
}
