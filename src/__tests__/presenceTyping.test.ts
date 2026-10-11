/**
 * Presence and typing are the two things a chat app is judged on: if the dot
 * lies or the "typing…" sticks, the product feels broken. Both are covered
 * here against the mock Realtime client (see dev/mock/realtime.ts), which
 * implements the same contract as Supabase.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getSupabase} from '../lib/supabase';
import {PresenceService} from '../services/PresenceService';
import {TypingService} from '../services/TypingService';
import {PRESENCE_ONLINE_WINDOW_MS, isUserOnline, resolveOnline} from '../utils/presence';

describe('presence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    PresenceService.stop();
    TypingService.reset();
    vi.useRealTimers();
  });

  it('lists the other client in the roster and drops it when it leaves', async () => {
    const client: any = getSupabase();
    expect(client).toBeTruthy();

    PresenceService.start('user-a');
    await Promise.resolve();

    // A second participant (the other phone) on the same topic.
    const peer = client.channel('grix-presence', {config: {presence: {key: 'user-b'}}});
    peer.subscribe();
    await peer.track({online_at: new Date().toISOString()});

    expect(PresenceService.isOnline('user-b')).toBe(true);
    expect(PresenceService.presenceOf('user-b')).toBe(true);
    // Somebody we have never seen is definitely offline once the roster is up.
    expect(PresenceService.presenceOf('user-c')).toBe(false);

    await peer.untrack();
    expect(PresenceService.isOnline('user-b')).toBe(false);
  });

  it('notifies subscribers so the UI can re-render', async () => {
    const client: any = getSupabase();
    PresenceService.start('user-a');
    await Promise.resolve();

    const listener = vi.fn();
    const unsubscribe = PresenceService.subscribe(listener);

    const peer = client.channel('grix-presence', {config: {presence: {key: 'user-b'}}});
    peer.subscribe();
    await peer.track({online_at: new Date().toISOString()});

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('falls back to is_online/last_seen before the roster is ready', () => {
    // No channel running → "unknown", so the durable columns decide.
    expect(PresenceService.presenceOf('user-b')).toBeNull();

    const fresh = new Date(Date.now() - 5_000).toISOString();
    const stale = new Date(Date.now() - PRESENCE_ONLINE_WINDOW_MS - 60_000).toISOString();

    expect(resolveOnline(null, true, fresh)).toBe(true);
    expect(resolveOnline(null, true, stale)).toBe(false);
    // Presence wins over a stale column (that is the whole point).
    expect(resolveOnline(true, false, stale)).toBe(true);
    // An authoritative "not in the roster" wins over a fresh column too.
    expect(resolveOnline(false, true, fresh)).toBe(false);
  });

  it('never reports somebody online from a future timestamp', () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(isUserOnline(true, future)).toBe(false);
  });
});

describe('typing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    TypingService.reset();
    vi.useRealTimers();
  });

  it('broadcasts to a subscriber on the same conversation', async () => {
    // A is typing; B is watching the same conversation.
    const received: string[][] = [];
    const release = TypingService.acquire('conv-1', (ids) => received.push(ids));

    TypingService.notifyTyping('conv-1', 'user-a');
    expect(received.at(-1)).toEqual(['user-a']);
    expect(TypingService.isTyping('conv-1', 'user-a')).toBe(true);

    // The publisher never sees its own name unless it asks for it.
    expect(TypingService.typingUsers('conv-1', 'user-a')).toEqual([]);

    release();
    TypingService.stopTyping('conv-1', 'user-a');
  });

  it('clears the indicator explicitly on stop (send / blur / unmount)', () => {
    const received: string[][] = [];
    const release = TypingService.acquire('conv-2', (ids) => received.push(ids));

    TypingService.notifyTyping('conv-2', 'user-a');
    expect(received.at(-1)).toEqual(['user-a']);

    TypingService.stopTyping('conv-2', 'user-a');
    expect(received.at(-1)).toEqual([]);
    expect(TypingService.isTyping('conv-2', 'user-a')).toBe(false);

    release();
  });

  it('stops by itself after the idle timeout, and expires stragglers', () => {
    const received: string[][] = [];
    const release = TypingService.acquire('conv-3', (ids) => received.push(ids));

    TypingService.notifyTyping('conv-3', 'user-a');
    expect(TypingService.isTyping('conv-3', 'user-a')).toBe(true);

    // 3.5 s of silence → the sender announces "not typing" by itself.
    vi.advanceTimersByTime(4_000);
    expect(TypingService.isTyping('conv-3', 'user-a')).toBe(false);

    release();
  });

  it('shares one channel per conversation (ref-counted)', async () => {
    const client: any = getSupabase();
    const before = client.channels.size;

    const releaseA = TypingService.acquire('conv-shared');
    const releaseB = TypingService.acquire('conv-shared');
    expect(client.channels.size).toBe(before + 1);

    releaseA();
    expect(client.channels.size).toBe(before + 1); // still one holder
    releaseB();
    // removeChannel() is async in the real client (and in the mock).
    await Promise.resolve();
    await Promise.resolve();
    expect(client.channels.size).toBe(before);
  });
});
