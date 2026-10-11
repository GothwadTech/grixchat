import { supabase } from '../lib/supabase';

/**
 * Typing indicators, done the way a messenger should:
 *
 *   • **One broadcast channel per conversation, ref-counted.** The chat screen
 *     and the chat-list row both need the same topic, so they *share* the
 *     channel instead of subscribing twice (the old code opened a fresh channel
 *     per component, per conversation).
 *   • **Explicit stop.** `true` is sent at most once every 2.5 s while somebody
 *     keeps typing, and `false` goes out immediately when they pause, send,
 *     blur the composer or leave the screen — the peer never waits for a
 *     timeout to see the dots disappear.
 *   • **Receiver-side TTL** (6 s) as a safety net for a dropped `false` (tab
 *     killed, network cut). Nothing is written to the database: typing is
 *     ephemeral by nature, and it must never cost a single row of egress.
 */

interface Entry {
  channel: any;
  refs: number;
  release: () => void;
}

/** A conversation stops being "typing" this long after the last keystroke. */
const TYPING_TTL_MS = 6_000;
/** Don't re-announce `true` more often than this while typing continues. */
const ANNOUNCE_EVERY_MS = 2_500;
/** Silence for this long ⇒ send `false` without waiting for the TTL. */
const IDLE_STOP_MS = 3_500;
const SWEEP_MS = 2_000;

type ConvListener = (typingUserIds: string[]) => void;

class TypingServiceImpl {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<ConvListener>>();
  /** conversationId → userId → expiry timestamp */
  private typing = new Map<string, Map<string, number>>();
  private lastAnnounced = new Map<string, number>();
  /** Sender-only channels for conversations we are not subscribed to. */
  private senderChannels = new Map<string, { channel: any; timer: ReturnType<typeof setTimeout> }>();
  private stopTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  // ── subscription (receivers) ─────────────────────────────────────────────

  /** Subscribe to one conversation. Returns a release function. */
  acquire(conversationId: string, listener?: ConvListener): () => void {
    if (!supabase || !conversationId) return () => {};

    let entry = this.entries.get(conversationId);
    if (!entry) {
      const channel = supabase.channel(`typing:${conversationId}`);

      channel.on('broadcast', { event: 'typing' }, ({ payload }: any) => {
        const userId = payload?.userId;
        if (!userId) return;
        if (payload.isTyping) {
          this.markTyping(conversationId, userId);
        } else {
          this.clearTyping(conversationId, userId);
        }
      });

      channel.subscribe();

      const release = () => {
        try {
          supabase.removeChannel(channel);
        } catch (_) {
          /* channel may already be gone */
        }
      };

      entry = { channel, refs: 0, release };
      this.entries.set(conversationId, entry);
    }
    entry.refs++;

    if (listener) {
      if (!this.listeners.has(conversationId)) this.listeners.set(conversationId, new Set());
      this.listeners.get(conversationId)!.add(listener);
    }

    this.ensureSweeper();

    return () => {
      const current = this.entries.get(conversationId);
      if (listener) this.listeners.get(conversationId)?.delete(listener);
      if (!current) return;
      current.refs--;
      if (current.refs <= 0) {
        current.release();
        this.entries.delete(conversationId);
        this.listeners.delete(conversationId);
        this.typing.delete(conversationId);
      }
      if (this.entries.size === 0 && this.sweeper) {
        clearInterval(this.sweeper);
        this.sweeper = null;
      }
    };
  }

  // ── sending (the person typing) ──────────────────────────────────────────

  /** Call on every keystroke. Cheap and throttled internally. */
  notifyTyping(conversationId: string, userId: string): void {
    if (!conversationId || !userId) return;

    const now = Date.now();
    const announcedAt = this.lastAnnounced.get(conversationId) || 0;
    if (now - announcedAt > ANNOUNCE_EVERY_MS) {
      this.lastAnnounced.set(conversationId, now);
      this.send(conversationId, userId, true);
    }

    const existing = this.stopTimers.get(conversationId);
    if (existing) clearTimeout(existing);
    this.stopTimers.set(
      conversationId,
      setTimeout(() => this.stopTyping(conversationId, userId), IDLE_STOP_MS),
    );
  }

  /** Call on send, on blur, on unmount, on tab hide: clears the peer's dots. */
  stopTyping(conversationId: string, userId: string): void {
    if (!conversationId || !userId) return;
    const timer = this.stopTimers.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      this.stopTimers.delete(conversationId);
    }
    if (!this.lastAnnounced.has(conversationId)) return; // nothing was announced
    this.lastAnnounced.delete(conversationId);
    this.send(conversationId, userId, false);
  }

  // ── reads ────────────────────────────────────────────────────────────────

  /** Users currently typing in this conversation, excluding `exceptUserId`. */
  typingUsers(conversationId: string, exceptUserId?: string | null): string[] {
    const map = this.typing.get(conversationId);
    if (!map || map.size === 0) return [];
    const now = Date.now();
    const ids: string[] = [];
    map.forEach((expiresAt, userId) => {
      if (expiresAt <= now) return;
      if (exceptUserId && userId === exceptUserId) return;
      ids.push(userId);
    });
    return ids;
  }

  isTyping(conversationId: string, userId: string): boolean {
    if (!conversationId || !userId) return false;
    const expiresAt = this.typing.get(conversationId)?.get(userId);
    return Boolean(expiresAt && expiresAt > Date.now());
  }

  /** Test/debug helper: forget every transient state. */
  reset(): void {
    this.typing.clear();
    this.lastAnnounced.clear();
    this.stopTimers.forEach((t) => clearTimeout(t));
    this.stopTimers.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private send(conversationId: string, userId: string, isTyping: boolean): void {
    const channel = this.entries.get(conversationId)?.channel || this.senderChannel(conversationId);
    if (!channel?.send) return;

    channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId, isTyping, at: Date.now() },
    });
  }

  /**
   * A channel we only *send* on (the chat screen is not mounted for this
   * conversation). Kept alive for a minute so a burst of keystrokes does not
   * open/close a channel each time.
   */
  private senderChannel(conversationId: string): any {
    const cached = this.senderChannels.get(conversationId);
    if (cached) {
      clearTimeout(cached.timer);
      cached.timer = setTimeout(() => this.dropSenderChannel(conversationId), 60_000);
      return cached.channel;
    }
    if (!supabase) return null;

    const channel = supabase.channel(`typing:${conversationId}`);
    channel.subscribe();
    this.senderChannels.set(conversationId, {
      channel,
      timer: setTimeout(() => this.dropSenderChannel(conversationId), 60_000),
    });
    return channel;
  }

  private dropSenderChannel(conversationId: string): void {
    const cached = this.senderChannels.get(conversationId);
    if (!cached) return;
    clearTimeout(cached.timer);
    this.senderChannels.delete(conversationId);
    try {
      supabase?.removeChannel(cached.channel);
    } catch (_) {
      /* ignore */
    }
  }

  private markTyping(conversationId: string, userId: string): void {
    if (!this.typing.has(conversationId)) this.typing.set(conversationId, new Map());
    this.typing.get(conversationId)!.set(userId, Date.now() + TYPING_TTL_MS);
    this.notify(conversationId);
  }

  private clearTyping(conversationId: string, userId: string): void {
    const map = this.typing.get(conversationId);
    if (!map?.delete(userId)) return;
    if (map.size === 0) this.typing.delete(conversationId);
    this.notify(conversationId);
  }

  private notify(conversationId: string): void {
    const listeners = this.listeners.get(conversationId);
    if (!listeners || listeners.size === 0) return;
    const ids = this.typingUsers(conversationId);
    listeners.forEach((listener) => {
      try {
        listener(ids);
      } catch (err) {
        console.warn('[Typing] listener failed:', err);
      }
    });
  }

  private ensureSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      this.typing.forEach((map, conversationId) => {
        let changed = false;
        map.forEach((expiresAt, userId) => {
          if (expiresAt <= now) {
            map.delete(userId);
            changed = true;
          }
        });
        if (changed) this.notify(conversationId);
      });
    }, SWEEP_MS);
  }
}

export const TypingService = new TypingServiceImpl();
