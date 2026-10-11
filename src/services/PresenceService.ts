import { supabase } from '../lib/supabase';

/**
 * Live "who is online" roster, carried by **one** Supabase Realtime Presence
 * channel per client (topic `grix-presence`, presence key = user id).
 *
 * Why presence instead of the `users.is_online` column:
 *   • a killed browser, a phone that went to sleep or a dropped network becomes
 *     "offline" the moment the websocket goes away — no stale flag that needs a
 *     timeout to expire;
 *   • join/leave/sync arrive as tiny websocket frames, so watching presence
 *     costs 0 database bytes (the `users` row is REPLICA IDENTITY FULL — every
 *     write to it is broadcast to every open chat with that user);
 *   • one channel for the whole app instead of one per chat.
 *
 * The roster is rebuilt from `presenceState()` on every sync/join/leave event,
 * which makes it self-healing after a reconnect.
 */

const PRESENCE_TOPIC = 'grix-presence';
/** Re-announce ourselves this often. Cheap: a single small websocket frame. */
const RETRACK_MS = 20_000;

type Listener = () => void;

class PresenceServiceImpl {
  private channel: any = null;
  private userId: string | null = null;
  private roster = new Set<string>();
  private listeners = new Set<Listener>();
  private version = 0;
  /** True once the roster has been read at least once (i.e. absence is proof). */
  private ready = false;
  private retrackTimer: ReturnType<typeof setInterval> | null = null;
  private bound = false;

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Idempotent: call it whenever the signed-in user changes. */
  start(userId: string | null | undefined): void {
    if (!supabase || !userId) {
      this.stop();
      return;
    }
    if (this.userId === userId && this.channel) return;

    this.stop();
    this.userId = userId;

    try {
      const channel = supabase.channel(PRESENCE_TOPIC, {
        config: { presence: { key: userId } },
      });
      this.channel = channel;

      channel
        .on('presence', { event: 'sync' }, () => this.rebuild())
        .on('presence', { event: 'join' }, () => this.rebuild())
        .on('presence', { event: 'leave' }, () => this.rebuild());

      if (typeof document !== 'undefined' && !this.bound) {
        this.bound = true;
        document.addEventListener('visibilitychange', this.handleVisibility);
        window.addEventListener('focus', this.handleVisibility);
        window.addEventListener('pagehide', this.handlePageHide);
      }

      channel.subscribe(async (status: string) => {
        if (status !== 'SUBSCRIBED') return;
        try {
          await channel.track({ online_at: new Date().toISOString() });
        } catch (err) {
          console.warn('[Presence] track failed:', err);
        }
        this.rebuild();
      });

      this.retrackTimer = setInterval(() => {
        if (document?.visibilityState === 'hidden') return;
        this.channel?.track?.({ online_at: new Date().toISOString() }).catch(() => {});
      }, RETRACK_MS);
    } catch (err) {
      console.warn('[Presence] channel setup failed:', err);
      this.channel = null;
    }
  }

  /** Leaves the roster and tears the channel down (sign-out, tab close). */
  stop(): void {
    if (this.retrackTimer) {
      clearInterval(this.retrackTimer);
      this.retrackTimer = null;
    }
    if (this.channel) {
      try {
        this.channel.untrack?.();
      } catch (_) {
        /* the socket may already be gone — nothing to undo */
      }
      try {
        supabase?.removeChannel(this.channel);
      } catch (_) {
        /* idem */
      }
      this.channel = null;
    }
    this.userId = null;
    this.ready = false;
    if (this.roster.size > 0) {
      this.roster = new Set();
      this.emit();
    }
  }

  // ── reads ────────────────────────────────────────────────────────────────

  isOnline(userId: string | null | undefined): boolean {
    if (!userId) return false;
    return this.roster.has(userId);
  }

  /**
   * `true` once the roster is authoritative: from then on a user *missing* from
   * it is genuinely offline (no more "wait for the heartbeat" guessing).
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * `true` — present in the roster · `false` — roster is ready and they are not
   * · `null` — roster not ready, fall back to `users.is_online`/`last_seen`.
   */
  presenceOf(userId: string | null | undefined): boolean | null {
    if (!userId) return null;
    if (this.roster.has(userId)) return true;
    return this.ready ? false : null;
  }

  onlineIds(): string[] {
    return [...this.roster];
  }

  /** `useSyncExternalStore` contract. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** `useSyncExternalStore` contract — a monotonic counter, so it is stable. */
  getSnapshot = (): number => this.version;

  // ── internals ────────────────────────────────────────────────────────────

  private handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      // The tab may have been frozen/throttled while hidden; re-announce.
      this.channel?.track?.({ online_at: new Date().toISOString() }).catch(() => {});
    }
  };

  private handlePageHide = () => {
    // Best-effort graceful leave so peers see the change instantly instead of
    // waiting for the socket timeout.
    try {
      this.channel?.untrack?.();
    } catch (_) {
      /* ignore */
    }
  };

  /** Re-derive the roster from the channel's authoritative presence state. */
  private rebuild(): void {
    const state = (() => {
      try {
        return this.channel?.presenceState?.() || {};
      } catch (_) {
        return {};
      }
    })();

    const next = new Set<string>(Object.keys(state));
    if (this.userId) next.add(this.userId); // we are, trivially, online
    this.ready = true;

    if (next.size === this.roster.size) {
      let same = true;
      for (const id of next) {
        if (!this.roster.has(id)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }

    this.roster = next;
    this.emit();
  }

  private emit(): void {
    this.version++;
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.warn('[Presence] listener failed:', err);
      }
    });
  }
}

export const PresenceService = new PresenceServiceImpl();
