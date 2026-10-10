/**
 * Pure-logic tests for the shared utils. These have no Supabase dependency,
 * so they also act as a fast canary that the toolchain itself is wired up.
 */
import {describe, expect, it, vi, afterEach} from 'vitest';
import {formatLastSeen, formatTime, toDate} from '../utils/dateUtils';
import {formatDetailedLastSeen} from '../utils/lastSeenFormatter';
import {evaluateChatLockState} from '../utils/scheduleUtils';

afterEach(() => {
  vi.useRealTimers();
});

describe('toDate', () => {
  it('parses ISO strings, numbers and Date objects', () => {
    const iso = '2026-05-17T10:46:32.000Z';
    expect(toDate(iso)?.toISOString()).toBe(iso);
    expect(toDate(1_700_000_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    const d = new Date(iso);
    expect(toDate(d)).toBe(d);
  });

  // Known edge case in the shipped code: `toDate` starts with `if (!timestamp)`,
  // so the numeric epoch 0 is treated as "missing". Harmless for real chat
  // timestamps, but pinned here so the behaviour is a decision, not an accident.
  it('treats the numeric epoch 0 as missing (documented quirk)', () => {
    expect(toDate(0)).toBeNull();
  });

  it('parses Firestore-style {seconds, nanoseconds} objects', () => {
    const d = toDate({seconds: 1_700_000_000, nanoseconds: 0});
    expect(d?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('returns null for junk input', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate('not a date')).toBeNull();
    expect(toDate({})).toBeNull();
  });
});

describe('formatTime', () => {
  it('renders 12-hour time with a zero-padded minute', () => {
    expect(formatTime(new Date(2026, 4, 17, 13, 5))).toBe('01:05 PM');
  });

  it('renders midnight as 12 AM, not 0 AM', () => {
    expect(formatTime(new Date(2026, 4, 17, 0, 0))).toBe('12:00 AM');
  });

  it('renders noon as 12 PM', () => {
    expect(formatTime(new Date(2026, 4, 17, 12, 30))).toBe('12:30 PM');
  });
});

describe('formatDetailedLastSeen', () => {
  it('reports OnlineNow inside the 150-second window', () => {
    expect(formatDetailedLastSeen(new Date())).toBe('OnlineNow');
  });

  it('reports minutes under an hour', () => {
    expect(formatDetailedLastSeen(new Date(Date.now() - 14 * 60 * 1000))).toBe('Active 14m ago');
  });

  it('returns Offline for a missing value', () => {
    expect(formatDetailedLastSeen(null)).toBe('Offline');
  });

  it('qualifies an older same-day timestamp with "today"', () => {
    // 20 hours ago is not guaranteed to be "today", so freeze the clock.
    vi.setSystemTime(new Date(2026, 4, 17, 22, 0, 0));
    const stamped = new Date(2026, 4, 17, 10, 20, 0);
    expect(formatDetailedLastSeen(stamped)).toBe('Active at 10:20 AM today');
  });

  it('qualifies a previous-day timestamp with "yesterday"', () => {
    vi.setSystemTime(new Date(2026, 4, 17, 9, 0, 0));
    const stamped = new Date(2026, 4, 16, 18, 45, 0);
    expect(formatDetailedLastSeen(stamped)).toBe('Active at 6:45 PM yesterday');
  });
});

describe('formatLastSeen', () => {
  it('maps OnlineNow to the header label "Online"', () => {
    expect(formatLastSeen(new Date())).toBe('Online');
  });

  it('rewrites the "Active" prefix to "last seen"', () => {
    expect(formatLastSeen(new Date(Date.now() - 14 * 60 * 1000))).toBe('last seen 14m ago');
  });
});

describe('evaluateChatLockState', () => {
  it('unlocks when restrictions are absent or disabled', () => {
    expect(evaluateChatLockState(null).isLocked).toBe(false);
    expect(evaluateChatLockState({
      enabled: false, neverAllowed: false, allowedDays: [], startTime: '', endTime: '',
    }).isLocked).toBe(false);
  });

  it('locks indefinitely when neverAllowed is set', () => {
    const r = evaluateChatLockState({
      enabled: true, neverAllowed: true, allowedDays: [], startTime: '', endTime: '',
    });
    expect(r.isLocked).toBe(true);
    expect(r.message).toContain('indefinitely');
  });

  it('locks on a disallowed weekday and names the allowed days', () => {
    vi.setSystemTime(new Date(2026, 4, 18, 12, 0)); // Monday
    const r = evaluateChatLockState({
      enabled: true, neverAllowed: false, allowedDays: [0, 6], startTime: '', endTime: '',
    });
    expect(r.isLocked).toBe(true);
    expect(r.message).toContain('Sun');
    expect(r.message).toContain('Sat');
  });

  it('locks outside a normal daytime window', () => {
    vi.setSystemTime(new Date(2026, 4, 18, 20, 0)); // Monday 20:00
    const r = evaluateChatLockState({
      enabled: true, neverAllowed: false, allowedDays: [1], startTime: '09:00', endTime: '17:00',
    });
    expect(r.isLocked).toBe(true);
    expect(r.message).toContain('Active window');
  });

  it('unlocks inside a normal daytime window', () => {
    vi.setSystemTime(new Date(2026, 4, 18, 12, 0)); // Monday 12:00
    const r = evaluateChatLockState({
      enabled: true, neverAllowed: false, allowedDays: [1], startTime: '09:00', endTime: '17:00',
    });
    expect(r.isLocked).toBe(false);
  });

  it('handles an overnight window that wraps past midnight', () => {
    vi.setSystemTime(new Date(2026, 4, 18, 23, 30)); // Monday 23:30
    const r = evaluateChatLockState({
      enabled: true, neverAllowed: false, allowedDays: [1], startTime: '22:00', endTime: '06:00',
    });
    expect(r.isLocked).toBe(false);
  });
});
