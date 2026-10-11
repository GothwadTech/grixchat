/**
 * GrixChat Mock Supabase — realtime channels.
 *
 * Emulates the three flavours GrixChat uses:
 *   • `postgres_changes` — driven by writes to the mock store, honouring
 *     `filter: 'receiver_id=eq.<id>'` / `conversation_id=in.(a,b)`
 *   • `broadcast` — an in-process pub/sub, used for typing indicators
 *   • `presence` — a roster shared by every channel on the topic, keyed by the
 *     `config.presence.key` (the user id), with sync/join/leave events — the
 *     same contract `PresenceService` relies on against real Supabase.
 *
 * Everything is single-tab: a real multi-device test still needs Supabase.
 */
import { store } from './store';
import { clone, evalOp, Row } from './utils';

interface Sub {
  type: string;
  filter?: string;
  schema?: string;
  table?: string;
  event?: string;
  cb: (payload: any) => void;
}

export class MockChannel {
  readonly topic: string;
  /** Presence key for this connection (Supabase: `config.presence.key`). */
  readonly presenceKey: string;
  private subs: Sub[] = [];
  private unsubscribed = false;
  private state: 'closed' | 'joining' | 'joined' = 'closed';
  private unsubscribeStore?: () => void;

  /** Shared across channels so broadcast() reaches every subscriber on the topic. */
  static registry = new Map<string, Set<MockChannel>>();
  /** Presence roster per topic — topic → key → payload list. */
  static presenceRegistry = new Map<string, Map<string, any[]>>();

  constructor(topic: string, opts?: any) {
    this.topic = topic;
    this.presenceKey = opts?.config?.presence?.key || `anon-${Math.random().toString(36).slice(2, 9)}`;
    if (!MockChannel.registry.has(topic)) MockChannel.registry.set(topic, new Set());
    MockChannel.registry.get(topic)!.add(this);
  }

  on(type: string, filterOrCb: any, maybeCb?: any): this {
    if (typeof filterOrCb === 'function') {
      this.subs.push({ type, cb: filterOrCb });
      return this;
    }
    const { event, filter, schema, table } = filterOrCb || {};
    this.subs.push({ type, filter, schema, table, event, cb: maybeCb });
    return this;
  }

  subscribe(cb?: (status: string, err?: any) => void): this {
    this.state = 'joined';
    this.unsubscribeStore = store.subscribe((payload) => this.dispatch(payload));
    // Mirror the async handshake the real client performs.
    Promise.resolve().then(() => cb?.('SUBSCRIBED'));
    return this;
  }

  unsubscribe(): Promise<'ok'> {
    this.unsubscribed = true;
    this.state = 'closed';
    this.unsubscribeStore?.();
    MockChannel.registry.get(this.topic)?.delete(this);
    // Dropping the socket drops the presence entry: announce it to the peers.
    const roster = MockChannel.presenceRegistry.get(this.topic);
    if (roster?.delete(this.presenceKey)) {
      MockChannel.broadcastPresence(this.topic, 'leave', this.presenceKey, {}, {});
      MockChannel.broadcastPresence(this.topic, 'sync', '', {}, {});
    }
    return Promise.resolve('ok' as const);
  }

  send(payload: { type: string; event?: string; payload?: any }): Promise<'ok'> {
    const peers = MockChannel.registry.get(this.topic) || new Set<MockChannel>();
    peers.forEach((peer) => {
      if (peer.unsubscribed) return;
      if (payload.type === 'broadcast' && payload.event) {
        peer.emitBroadcast(payload.event, payload.payload ?? {});
      }
    });
    return Promise.resolve('ok' as const);
  }

  track(state: Record<string, any>): Promise<'ok'> {
    if (!MockChannel.presenceRegistry.has(this.topic)) {
      MockChannel.presenceRegistry.set(this.topic, new Map());
    }
    MockChannel.presenceRegistry.get(this.topic)!.set(this.presenceKey, [state]);

    (MockChannel.registry.get(this.topic) || new Set<MockChannel>()).forEach((peer) => {
      if (peer.unsubscribed) return;
      peer.emitPresence('join', this.presenceKey, state, {});
      peer.emitPresence('sync', '', {}, {});
    });
    return Promise.resolve('ok' as const);
  }

  untrack(): Promise<'ok'> {
    const roster = MockChannel.presenceRegistry.get(this.topic);
    const before = roster?.get(this.presenceKey) || [];
    roster?.delete(this.presenceKey);

    (MockChannel.registry.get(this.topic) || new Set<MockChannel>()).forEach((peer) => {
      if (peer.unsubscribed) return;
      peer.emitPresence('leave', this.presenceKey, {}, before);
      peer.emitPresence('sync', '', {}, {});
    });
    return Promise.resolve('ok' as const);
  }

  /** Same shape as the real client: key → array of tracked payloads. */
  presenceState(): Record<string, any[]> {
    const roster = MockChannel.presenceRegistry.get(this.topic);
    const out: Record<string, any[]> = {};
    roster?.forEach((payloads, key) => {
      out[key] = clone(payloads);
    });
    return out;
  }

  // --- internals -----------------------------------------------------------

  private static broadcastPresence(
    topic: string,
    event: string,
    key: string,
    current: any,
    prev: any,
  ) {
    (MockChannel.registry.get(topic) || new Set<MockChannel>()).forEach((peer) => {
      if (peer.unsubscribed) return;
      peer.emitPresence(event, key, current, prev);
    });
  }

  private matchesFilter(sub: Sub, payload: any): boolean {
    if (sub.table && sub.table !== payload.table) return false;
    if (sub.event && sub.event !== '*' && sub.event !== payload.eventType) return false;
    if (!sub.filter) return true;
    const eq = /^([a-z_]+)=([a-z]+)\.(.*)$/i.exec(sub.filter);
    if (!eq) return true; // unsupported filter shape → permissive
    const [, column, op, rawValue] = eq;
    if (op.toLowerCase() === 'in') {
      // PostgREST: `column=in.(a,b,c)` — strip the parens, then the optional
      // double quotes PostgREST adds around values that contain a comma.
      const list = rawValue
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .split(',')
        .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
        .filter((s) => s.length > 0);
      return evalOp(payload.new, column, 'in', list);
    }
    return evalOp(payload.new, column, op.toLowerCase(), rawValue);
  }

  private dispatch(payload: { eventType: string; new: Row; old: Row; table: string }) {
    if (this.unsubscribed) return;
    this.subs.forEach((sub) => {
      if (sub.type !== 'postgres_changes') return;
      if (!this.matchesFilter(sub, payload)) return;
      sub.cb({
        eventType: payload.eventType,
        new: clone(payload.new),
        old: clone(payload.old),
        schema: sub.schema || 'public',
        table: payload.table,
      });
    });
  }

  private emitBroadcast(event: string, payload: any) {
    this.subs.forEach((sub) => {
      if (sub.type !== 'broadcast') return;
      if (sub.event && sub.event !== event) return;
      sub.cb({ event, payload: clone(payload) });
    });
  }

  private emitPresence(event: string, key: string, current: any, prev: any) {
    this.subs.forEach((sub) => {
      if (sub.type !== 'presence') return;
      sub.cb({ event, key, current, prev });
    });
  }
}
