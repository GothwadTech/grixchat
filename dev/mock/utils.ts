/**
 * GrixChat Mock Supabase — shared helpers.
 *
 * Deliberately dependency-free so it can run in the browser (dev server),
 * in Vitest (jsdom) and in plain Node.
 */

export type Row = Record<string, any>;

/** Deterministic-friendly UUID v4 generator. */
export function uuid(): string {
  // Prefer the platform one; fall back for old jsdom versions.
  const c: any = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** ISO string N hours in the past — handy for realistic seed timelines. */
export function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

export function daysAgo(d: number): string {
  return hoursAgo(d * 24);
}

export function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

export function clone<T>(v: T): T {
  if (v === undefined) return v;
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}

/** Loose `==` that also tolerates number/string and Date/ISO mismatches. */
export function looseEq(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => looseEq(x, b[i]));
  }
  const sa = typeof a === 'object' ? JSON.stringify(a) : String(a);
  const sb = typeof b === 'object' ? JSON.stringify(b) : String(b);
  return sa === sb;
}

export function coerceNumber(v: any): number {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const d = Date.parse(String(v));
  return Number.isNaN(d) ? NaN : d;
}

/**
 * PostgREST `or=` mini language: `col.eq.value,col.in.(a,b),col.is.null`
 * Only the operators GrixChat actually emits are supported.
 */
export function parseOrExpression(expr: string): Array<{ column: string; op: string; value: any }> {
  return expr.split(',').map((raw) => {
    const part = raw.trim();
    const firstDot = part.indexOf('.');
    const column = part.slice(0, firstDot);
    const rest = part.slice(firstDot + 1);
    const secondDot = rest.indexOf('.');
    const op = secondDot === -1 ? rest : rest.slice(0, secondDot);
    let value: any = secondDot === -1 ? '' : rest.slice(secondDot + 1);
    const listMatch = /^\((.*)\)$/.exec(String(value));
    if (listMatch) value = listMatch[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    else value = String(value).replace(/^"|"$/g, '');
    if (value === 'null') value = null;
    return { column, op, value };
  });
}

export function evalOp(row: Row, column: string, op: string, value: any): boolean {
  const actual = row[column];
  switch (op) {
    case 'eq':
      return looseEq(actual, value);
    case 'neq':
    case 'ne':
      return !looseEq(actual, value);
    case 'gt':
      return coerceNumber(actual) > coerceNumber(value);
    case 'gte':
      return coerceNumber(actual) >= coerceNumber(value);
    case 'lt':
      return coerceNumber(actual) < coerceNumber(value);
    case 'lte':
      return coerceNumber(actual) <= coerceNumber(value);
    case 'in': {
      const list = Array.isArray(value) ? value : [value];
      return list.some((v) => looseEq(actual, v));
    }
    case 'is':
      return value === null ? actual === null || actual === undefined : looseEq(actual, value);
    case 'like':
    case 'ilike': {
      const pattern = String(value)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      const re = new RegExp(`^${pattern}$`, op === 'ilike' ? 'i' : '');
      return re.test(String(actual ?? ''));
    }
    case 'contains': {
      if (Array.isArray(actual)) {
        const wanted = Array.isArray(value) ? value : [value];
        return wanted.every((w) => actual.some((a) => looseEq(a, w)));
      }
      return String(actual ?? '').includes(String(value));
    }
    case 'cs':
      return evalOp(row, column, 'contains', value);
    default:
      // Unknown operator → permissive, so an unsupported call never blanks a screen.
      return true;
  }
}
