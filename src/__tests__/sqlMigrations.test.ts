/**
 * Guards for the database setup files in `sql/`.
 *
 * The rules these tests enforce:
 *   1. a brand-new Supabase project can run the whole set and end up complete
 *   2. an existing project can run the SAME set again, at any time, without an
 *      error and without losing data
 *   3. every file stays between 600 and 1000 lines — append to the current file
 *      until it is full, then start the next number (no tiny files, no 2000-line
 *      files)
 *   4. every file opens with a short "COVERS:" header; detail lives in the .md
 *
 * Rule 2 was broken for a long time: the setup began with `DROP TABLE … CASCADE`
 * for every core table, so re-running it on a live database silently deleted
 * every user, message and post (it reported zero errors while doing it).
 *
 * @vitest-environment node
 */
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {describe, expect, it} from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, '..', '..', 'sql');

/** Numbered migrations, in execution order. */
const migrations = readdirSync(sqlDir)
  .filter((f) => /^0\d_.+\.sql$/.test(f))
  .sort();

const sqlOf = (name: string) => readFileSync(join(sqlDir, name), 'utf8');
const linesOf = (name: string) => sqlOf(name).split('\n').length;

/** SQL with comments removed, so prose about a rule cannot trip it. */
function code(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/** Upper bound from the file-size rule; the lower bound applies to every file but the current one. */
const MAX_LINES = 1000;
const MIN_FULL_FILE_LINES = 600;

describe('sql/ migrations', () => {
  it('starts at 01 and is contiguous', () => {
    const numbers = migrations.map((f) => Number(f.slice(0, 2)));
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('keeps every file between 600 and 1000 lines (the last one may still be filling up)', () => {
    migrations.forEach((file, index) => {
      const isLast = index === migrations.length - 1;
      const lines = linesOf(file);
      expect(lines, `${file} is over the ${MAX_LINES}-line limit — start the next file`).toBeLessThanOrEqual(MAX_LINES);
      if (!isLast) {
        expect(
          lines,
          `${file} is only ${lines} lines — append to it instead of starting a new file`,
        ).toBeGreaterThanOrEqual(MIN_FULL_FILE_LINES);
      }
    });
  });

  it('explains what it covers in a short header', () => {
    for (const file of migrations) {
      const head = sqlOf(file).split('\n').slice(0, 20).join('\n');
      expect(head, `${file} needs a short "COVERS:" header`).toMatch(/COVERS/);
      expect(head, `${file} should name the file itself`).toContain(file);
    }
  });

  it('never drops or truncates a table — re-running must not delete data', () => {
    const offenders: string[] = [];
    for (const file of migrations) {
      const body = code(sqlOf(file));
      for (const pattern of [/DROP\s+TABLE/i, /TRUNCATE\s+/i, /DROP\s+SCHEMA/i, /DROP\s+COLUMN/i]) {
        if (pattern.test(body)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('creates tables idempotently', () => {
    for (const file of migrations) {
      const creates = code(sqlOf(file)).match(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi) || [];
      expect(creates, `${file} has a CREATE TABLE without IF NOT EXISTS`).toEqual([]);
    }
  });

  it('drops every policy before re-creating it, so definitions can change', () => {
    for (const file of migrations) {
      const body = code(sqlOf(file));
      const created = body.match(/CREATE\s+POLICY\s+"([^"]+)"/gi) || [];
      const dropped = body.match(/DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"/gi) || [];
      expect(created.length, `${file}: more CREATE POLICY than DROP POLICY IF EXISTS`).toBeLessThanOrEqual(
        dropped.length,
      );
    }
  });

  it('creates indexes with IF NOT EXISTS and triggers with DROP ... IF EXISTS', () => {
    for (const file of migrations) {
      const body = code(sqlOf(file));
      expect(body.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi) || [], `${file}: index`).toEqual([]);
      const triggers = body.match(/CREATE\s+TRIGGER\s+(\w+)/gi) || [];
      const dropped = body.match(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+(\w+)/gi) || [];
      expect(triggers.length, `${file}: trigger without DROP TRIGGER IF EXISTS first`).toBeLessThanOrEqual(
        dropped.length,
      );
    }
  });

  it('does not leave two triggers doing the same conversation-preview write', () => {
    const all = migrations.map(sqlOf).join('\n');
    // the insert-only duplicate from the old 05 file must be dropped, not created
    expect(all).toMatch(/DROP TRIGGER IF EXISTS trg_update_conversation_on_message/);
    expect(code(all)).not.toMatch(/CREATE TRIGGER trg_update_conversation_on_message/i);
  });
});
