/**
 * GrixChat Mock Supabase — PostgREST-compatible query builder.
 *
 * Implements exactly the surface GrixChat calls (verified by grepping the
 * codebase): select / insert / update / upsert / delete chained with
 * eq, neq, in, or, contains, match, gt, lt, order, limit, range,
 * single, maybeSingle — plus embedded resources such as
 * `select('*, users:user_id(username, photo_url)')`.
 */
import { store } from './store';
import {
  clone, coerceNumber, evalOp, looseEq, nowISO, parseOrExpression, Row, uuid,
} from './utils';

/** Foreign-key column → target table, for embedded-resource resolution. */
const FK_TARGET: Record<string, string> = {
  user_id: 'users',
  sender_id: 'users',
  receiver_id: 'users',
  caller_id: 'users',
  follower_id: 'users',
  following_id: 'users',
  from_user_id: 'users',
  to_user_id: 'users',
  blocked_user_id: 'users',
  conversation_id: 'conversations',
  post_id: 'posts',
  video_id: 'tube_videos',
  target_id: 'posts',
  reply_to: 'messages',
  call_id: 'calls',
};

type Predicate = { column: string; op: string; value: any };

interface ParsedColumn {
  raw: string;
  /** `*` or a plain column name */
  column?: string;
  /** embedded alias, e.g. `users` in `users:user_id(...)` */
  alias?: string;
  /** the ref between the alias and the parens, e.g. `user_id` */
  ref?: string;
  /** nested column list */
  nested?: string;
}

/**
 * Splits a PostgREST select string on top-level commas only, so the comma
 * inside `users:user_id(a, b)` does not split the embedded resource.
 */
function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseSelect(selectStr: string): ParsedColumn[] {
  return splitTopLevel(selectStr).map((part) => {
    const parenIdx = part.indexOf('(');
    if (parenIdx === -1) return { raw: part, column: part };
    const head = part.slice(0, parenIdx).trim();
    const nested = part.slice(parenIdx + 1, part.lastIndexOf(')'));
    const colonIdx = head.indexOf(':');
    if (colonIdx === -1) return { raw: part, column: head, nested };
    return {
      raw: part,
      alias: head.slice(0, colonIdx).trim(),
      ref: head.slice(colonIdx + 1).trim(),
      nested,
    };
  });
}

/**
 * Turns the ref in `alias:ref(...)` into a concrete foreign-key column on
 * `row`, then reports which table that column points at.
 *
 *   'user_id'                          → { fk: 'user_id',      table: 'users' }
 *   'users!calls_caller_id_fkey'       → { fk: 'sender/caller', table: 'users' }
 *   'conversations'                    → { fk: 'conversation_id', table: 'conversations' }
 *   'users' on a messages row          → { fk: 'sender_id',    table: 'users' }
 */
/** `reverse: true` means "children of this row", i.e. look the relationship up backwards. */
interface FkResolution { fk: string; table: string | null; reverse: boolean }

function resolveFk(ref: string, row: Row, alias?: string): FkResolution {
  const bare = ref.split('!')[0].trim();

  // Already an fk column name.
  if (FK_TARGET[bare]) return { fk: bare, table: FK_TARGET[bare], reverse: false };

  // A table name was given — find the column on this row that points at it.
  if (store.db[bare]) {
    const singular = bare.replace(/ies$/, 'y').replace(/s$/, '');
    const guess = `${singular}_id`;
    if (row[guess] !== undefined) return { fk: guess, table: bare, reverse: false };

    // `sender:users (...)` on a messages row — pick the fk that targets `users`.
    const pointing = Object.keys(row).filter((k) => FK_TARGET[k] === bare);
    if (pointing.length === 1) return { fk: pointing[0], table: bare, reverse: false };
    if (pointing.length > 1) {
      // Ambiguous in PostgREST too; the alias is the tie-breaker, matching the
      // way PostgREST uses the alias as a relationship hint.
      const hinted = alias ? `${alias}_id` : '';
      if (hinted && pointing.includes(hinted)) return { fk: hinted, table: bare, reverse: false };
      return { fk: pointing[0], table: bare, reverse: false };
    }

    // No fk on this row points at that table, so this is the other direction:
    // `participants:conversation_participants(...)` from a conversations row.
    return { fk: guess, table: bare, reverse: true };
  }

  return { fk: bare, table: null, reverse: false };
}

function resolveEmbedded(parsed: ParsedColumn, row: Row, alias?: string, parentTable?: string): any {
  const ref = parsed.ref!;
  const {fk, table, reverse} = resolveFk(ref, row, alias);
  const idValue = row[fk];

  // to-one: follow the fk on this row
  if (table && !reverse) {
    // A null fk (e.g. a message with no reply) is a valid "nothing to join".
    if (idValue === undefined || idValue === null) return null;
    const match = store.table(table).find((r) => looseEq(r.id, idValue));
    return match ? project(match, parsed.nested!) : null;
  }

  // to-many: rows in `ref` whose fk points back at this row's id.
  // The back-reference column must target the PARENT table, e.g. for
  // `participants:conversation_participants(...)` on a conversations row the
  // back-reference is conversation_participants.conversation_id → conversations.
  const childTable = ref.split('!')[0].trim();
  if (store.db[childTable]) {
    const backRefs = parentTable
      ? Object.keys(FK_TARGET).filter((k) => FK_TARGET[k] === parentTable)
      : Object.keys(FK_TARGET);
    return store
      .table(childTable)
      .filter((r) => backRefs.some((k) => looseEq(r[k], row.id)))
      .map((r) => project(r, parsed.nested!, childTable));
  }

  if (alias) {
    // eslint-disable-next-line no-console
    console.warn(`[grixMock] could not resolve embedded resource '${parsed.raw}' (alias '${alias}')`);
  }
  return null;
}

function project(row: Row, nested: string, parentTable?: string): Row {
  const parts = parseSelect(nested);
  if (parts.length === 1 && parts[0].column === '*') return clone(row);
  const out: Row = {};
  for (const p of parts) {
    if (p.column === '*') Object.assign(out, clone(row));
    else if (p.column) out[p.column] = row[p.column];
    else if (p.alias) out[p.alias] = resolveEmbedded(p, row, p.alias, parentTable);
  }
  return out;
}

function projectRow(row: Row, selectStr: string | undefined, parentTable?: string): Row {
  if (!selectStr || selectStr.trim() === '*') return clone(row);
  return project(row, selectStr, parentTable);
}

export class MockQueryBuilder implements PromiseLike<{ data: any; error: any; count: number | null }> {
  private table: string;
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any = null;
  private predicates: Predicate[] = [];
  private orPredicates: Array<{ expr: string }> = [];
  private orderings: Array<{ column: string; ascending: boolean; nullsFirst: boolean }> = [];
  private limitCount: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private selectColumns: string | undefined = '*';
  private wantCount = false;
  private singleMode: 'off' | 'single' | 'maybeSingle' = 'off';
  private returning = true;

  constructor(table: string) {
    this.table = table;
  }

  // --- projections ---------------------------------------------------------
  select(columns: string = '*', opts?: { count?: string; head?: boolean }) {
    this.selectColumns = columns;
    if (opts?.count) this.wantCount = true;
    if (this.mode === 'select') this.mode = 'select';
    return this;
  }

  // --- mutations -----------------------------------------------------------
  insert(rows: any, _opts?: any) {
    this.mode = 'insert';
    this.payload = rows;
    return this;
  }

  update(patch: any, _opts?: any) {
    this.mode = 'update';
    this.payload = patch;
    return this;
  }

  upsert(rows: any, opts?: { onConflict?: string }) {
    this.mode = 'upsert';
    this.payload = rows;
    (this as any).onConflict = opts?.onConflict || 'id';
    return this;
  }

  delete(_opts?: any) {
    this.mode = 'delete';
    return this;
  }

  // --- filters -------------------------------------------------------------
  eq(column: string, value: any) { this.predicates.push({ column, op: 'eq', value }); return this; }
  neq(column: string, value: any) { this.predicates.push({ column, op: 'neq', value }); return this; }
  gt(column: string, value: any) { this.predicates.push({ column, op: 'gt', value }); return this; }
  gte(column: string, value: any) { this.predicates.push({ column, op: 'gte', value }); return this; }
  lt(column: string, value: any) { this.predicates.push({ column, op: 'lt', value }); return this; }
  lte(column: string, value: any) { this.predicates.push({ column, op: 'lte', value }); return this; }
  like(column: string, value: any) { this.predicates.push({ column, op: 'like', value }); return this; }
  ilike(column: string, value: any) { this.predicates.push({ column, op: 'ilike', value }); return this; }
  is(column: string, value: any) { this.predicates.push({ column, op: 'is', value }); return this; }

  in(column: string, values: any[]) { this.predicates.push({ column, op: 'in', value: values }); return this; }

  contains(column: string, value: any) { this.predicates.push({ column, op: 'contains', value }); return this; }
  containedBy(column: string, value: any[]) {
    this.predicates.push({ column, op: 'containedBy', value });
    return this;
  }

  match(obj: Record<string, any>) {
    Object.entries(obj).forEach(([column, value]) => this.predicates.push({ column, op: 'eq', value }));
    return this;
  }

  not(column: string, op: string, value: any) {
    this.predicates.push({ column, op: `not.${op}`, value });
    return this;
  }

  or(expr: string) { this.orPredicates.push({ expr }); return this; }

  filter(column: string, op: string, value: any) {
    this.predicates.push({ column, op, value });
    return this;
  }

  // --- shaping -------------------------------------------------------------
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string }) {
    this.orderings.push({
      column,
      ascending: opts?.ascending !== false,
      nullsFirst: opts?.nullsFirst === true,
    });
    return this;
  }

  limit(n: number) { this.limitCount = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybeSingle'; return this; }
  throwOnError(_v = true) { return this; }

  // --- execution -----------------------------------------------------------
  private matches(row: Row): boolean {
    const direct = this.predicates.every((p) => {
      if (p.op.startsWith('not.')) return !evalOp(row, p.column, p.op.slice(4), p.value);
      if (p.op === 'containedBy') {
        const arr = Array.isArray(row[p.column]) ? row[p.column] : [row[p.column]];
        const allowed = Array.isArray(p.value) ? p.value : [p.value];
        return arr.every((a) => allowed.some((v) => looseEq(a, v)));
      }
      return evalOp(row, p.column, p.op, p.value);
    });
    if (!direct) return false;
    return this.orPredicates.every(({ expr }) =>
      parseOrExpression(expr).some((p) => evalOp(row, p.column, p.op, p.value)),
    );
  }

  private sort(rows: Row[]): Row[] {
    if (this.orderings.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const o of this.orderings) {
        const av = a[o.column];
        const bv = b[o.column];
        const aNull = av === null || av === undefined;
        const bNull = bv === null || bv === undefined;
        if (aNull || bNull) {
          if (aNull && bNull) continue;
          return aNull ? (o.nullsFirst ? -1 : 1) : (o.nullsFirst ? 1 : -1);
        }
        const an = coerceNumber(av);
        const bn = coerceNumber(bv);
        const cmp = !Number.isNaN(an) && !Number.isNaN(bn)
          ? an - bn
          : String(av).localeCompare(String(bv));
        if (cmp !== 0) return o.ascending ? cmp : -cmp;
      }
      return 0;
    });
  }

  private applyLimit(rows: Row[]): Row[] {
    let out = rows;
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      out = out.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitCount !== null) out = out.slice(0, this.limitCount);
    return out;
  }

  /** Mutations default `created_at`/`updated_at` like the Postgres DEFAULTs. */
  private withDefaults(row: Row): Row {
    const out: Row = { ...row };
    if (out.id === undefined) out.id = uuid();
    if (out.created_at === undefined) out.created_at = nowISO();
    if (this.table === 'users' && out.updated_at === undefined) out.updated_at = nowISO();
    if (this.table === 'conversations' && out.updated_at === undefined) out.updated_at = nowISO();
    return out;
  }

  private run(): { data: any; error: any; count: number | null } {
    const rows = store.table(this.table);
    const ok = (data: any, count: number | null = null) => ({ data, error: null, count });

    if (this.mode === 'insert' || this.mode === 'upsert') {
      const incoming: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload];
      const written: Row[] = [];
      const conflictKey = (this as any).onConflict || 'id';
      for (const raw of incoming) {
        const row = this.withDefaults(raw);
        if (this.mode === 'upsert') {
          const existing = rows.find((r) => looseEq(r[conflictKey], row[conflictKey]));
          if (existing) {
            const before = clone(existing);
            Object.assign(existing, row);
            store.emit('UPDATE', this.table, existing, before);
            written.push(clone(existing));
            continue;
          }
        }
        rows.push(row);
        store.emit('INSERT', this.table, row);
        written.push(clone(row));
      }
      store.save();
      if (!this.returning) return ok(null);
      const projected = written.map((r) => projectRow(r, this.selectColumns, this.table));
      return ok(this.singleMode !== 'off' ? (projected[0] ?? null) : projected);
    }

    if (this.mode === 'update') {
      const touched: Row[] = [];
      rows.forEach((row) => {
        if (!this.matches(row)) return;
        const before = clone(row);
        Object.assign(row, this.payload);
        if (this.table === 'users' || this.table === 'conversations') row.updated_at = nowISO();
        store.emit('UPDATE', this.table, row, before);
        touched.push(clone(row));
      });
      store.save();
      if (!this.returning) return ok(null);
      const projected = touched.map((r) => projectRow(r, this.selectColumns, this.table));
      return ok(this.singleMode !== 'off' ? (projected[0] ?? null) : projected);
    }

    if (this.mode === 'delete') {
      const removed: Row[] = [];
      const kept = rows.filter((row) => {
        if (!this.matches(row)) return true;
        removed.push(clone(row));
        return false;
      });
      store.setTable(this.table, kept);
      removed.forEach((r) => store.emit('DELETE', this.table, r, r));
      const projected = removed.map((r) => projectRow(r, this.selectColumns, this.table));
      return ok(this.singleMode !== 'off' ? (projected[0] ?? null) : projected);
    }

    // --- select ---
    let matched = rows.filter((r) => this.matches(r));
    const total = this.wantCount ? matched.length : null;
    matched = this.sort(matched);
    matched = this.applyLimit(matched);

    if (this.singleMode === 'single') {
      if (matched.length === 0) {
        return {
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: '', hint: '' },
          count: total,
        };
      }
      return ok(projectRow(matched[0], this.selectColumns, this.table), total);
    }
    if (this.singleMode === 'maybeSingle') {
      return ok(matched.length ? projectRow(matched[0], this.selectColumns, this.table) : null, total);
    }
    return ok(matched.map((r) => projectRow(r, this.selectColumns, this.table)), total);
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    // The real client never rejects — errors come back in the result object.
    return Promise.resolve(this.run()).then(onfulfilled as any, onrejected as any);
  }
}
