'use client';

/**
 * Client-side block list. Blocking is personal: the blocked device's
 * messages are hidden and their audio is muted locally. Stored in
 * localStorage (per browser) — no server round-trip needed.
 */

const KEY = 'talkfree_blocked_devices';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full/blocked — blocking just won't persist */
  }
}

export function isBlocked(deviceId: string): boolean {
  return read().includes(deviceId);
}

export function blockDevice(deviceId: string): void {
  const list = read();
  if (!list.includes(deviceId)) write([...list, deviceId]);
}

export function unblockDevice(deviceId: string): void {
  write(read().filter((d) => d !== deviceId));
}

export function getBlockedDevices(): string[] {
  return read();
}
