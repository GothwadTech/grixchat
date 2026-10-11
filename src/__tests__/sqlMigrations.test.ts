/**
 * Guards for the database setup files in `sql/`.
 *
 * These are the rules that keep the two supported scenarios true:
 *   1. a brand-new Supabase project can run the whole set and end up complete
 *   2. an existing project can run the SAME set again, at any time, without an
 *      error and without losing data
 *
 * Rule 2 was broken for a long time: `01_core_schema.sql` began with
 * `DROP TABLE … CASCADE` for every core table, so re-running "the setup" on a
 * live database silently deleted every user, message and post (it reported zero
 * errors while doing it). There is a test for that now.
 *
 * @vitest-environment node
 */
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {describe, expect, it} from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, '..', '..', 'sql');
const repoRoot = join(here, '..', '..');

/** Every numbered migration, in execution order. */
const migrations = readdirSync(sqlDir)
  .filter((f) => /^0\d_.+\.sql$/.test(f))
  .sort();

const sqlOf = (name: string) => readFileSync(join(sqlDir, name), 'utf8');

/** SQL with line/block comments removed, so prose about a rule cannot trip it. */
function code(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

describe('sql/ migrations', () => {
  it('covers 01 through 09 and nothing else is left loose', () => {
    expect(migrations.map((f) => f.slice(0, 2))).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09'],
    );
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
      // 01/02/03/06/09 own policies; each CREATE must have a matching DROP IF EXISTS.
      expect(created.length, `${file}: more CREATE POLICY than DROP POLICY IF EXISTS`).toBeLessThanOrEqual(
        dropped.length,
      );
    }
  });

  it('indexes are created with IF NOT EXISTS', () => {
    for (const file of migrations) {
      const creates = code(sqlOf(file)).match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi) || [];
      expect(creates, `${file} has a CREATE INDEX without IF NOT EXISTS`).toEqual([]);
    }
  });

  it('the generated one-file bundle is in sync (npm run sql:bundle)', () => {
    // Throws (non-zero exit) when the bundle is stale.
    const out = execFileSync(process.execPath, [join(repoRoot, 'scripts', 'build-sql-bundle.mjs'), '--check'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(out).toMatch(/up to date/);
  });

  it('the bundle contains every migration, in order', () => {
    const bundle = readFileSync(join(sqlDir, 'grixchat_full_setup.sql'), 'utf8');
    let cursor = -1;
    for (const file of migrations) {
      const at = bundle.indexOf(`-- PART ${String(Number(file.slice(0, 2)))}/${migrations.length} — sql/${file}`);
      expect(at, `${file} missing from the bundle`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });
});
