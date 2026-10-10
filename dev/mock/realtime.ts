/**
 * GrixChat Mock Supabase — realtime channels.
 *
 * Emulates the three flavours GrixChat uses:
 *   • `postgres_changes` — driven by writes to the mock store, honouring
 *     `filter: 'receiver_id=eq.<id>'` / `conversation_id=in.(a,b)`
 *   • `broadcast` — an in-process pub/sub, used for typing indicators
 *   • `presence` — a local roster, used for online status + call signalling
 *
 * Everything is single-tab: a real multi-device test still needs Supabase.
 */
import { store } from './store';
import { clone, evalOp, Row, uuid } from './utils';

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
  private subs: Sub[] = [];
  private unsubscribed = false;
  private state: 'closed' | 'joining' | 'joined' = 'closed';
  private presenceState: Record<string, any[]> = {};
  private unsubscribeStore?: () => void;

  /** Shared across channels so broadcast() reaches every subscriber on the topic. */
  static registry = new Map<string, Set<MockChannel>>();

  constructor(topic: string) {
    this.topic = topic;
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
    const key = uuid();
    this.presenceState[key] = [state];
    this.emitPresence('join', key, state, {});
    return Promise.resolve('ok' as const);
  }

  untrack(): Promise<'ok'> {
    const before = { ...this.presenceState };
    this.presenceState = {};
    this.emitPresence('leave', '', {}, before);
    return Promise.resolve('ok' as const);
  }

  // --- internals -----------------------------------------------------------
  private matchesFilter(sub: Sub, payload: any): boolean {
    if (sub.table && sub.table !== payload.table) return false;
    if (sub.event && sub.event !== '*' && sub.event !== payload.eventType) return false;
    if (!sub.filter) return true;
    const eq = /^([a-z_]+)=([a-z]+)\.(.*)$/i.exec(sub.filter);
    if (!eq) return true; // unsupported filter shape → permissive
    const [, column, op, rawValue] = eq;
    if (op.toLowerCase() === 'in') {
      const list = rawValue.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim());
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
