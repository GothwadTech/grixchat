#!/usr/bin/env node
/**
 * Bundle budget gate. Fails CI when the shipped JS grows past the budget, so a
 * stray heavy import is caught in review instead of by users on slow phones.
 *
 * Budgets are gzip sizes, in bytes. Raise them deliberately, with a reason in
 * the PR, never to make a failing build pass.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');
const PER_CHUNK_BUDGET = 160 * 1024; // largest single chunk (LiveKit is ~139 KB today)
const TOTAL_BUDGET = 1000 * 1024;    // all JS together

let files;
try {
  files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`check-bundle: ${DIST_ASSETS} not found. Run "npm run build" first.`);
  process.exit(1);
}

const sizes = files.map((f) => {
  const raw = readFileSync(join(DIST_ASSETS, f));
  return { file: f, gzip: gzipSync(raw).length, raw: statSync(join(DIST_ASSETS, f)).size };
});
sizes.sort((a, b) => b.gzip - a.gzip);

const total = sizes.reduce((sum, s) => sum + s.gzip, 0);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log('Largest JS chunks (gzip):');
for (const s of sizes.slice(0, 8)) console.log(`  ${kb(s.gzip).padStart(10)}  ${s.file}`);
console.log(`Total JS (gzip): ${kb(total)} / budget ${kb(TOTAL_BUDGET)}`);

const failures = [];
for (const s of sizes) {
  if (s.gzip > PER_CHUNK_BUDGET) failures.push(`${s.file} is ${kb(s.gzip)} gzip (chunk budget ${kb(PER_CHUNK_BUDGET)})`);
}
if (total > TOTAL_BUDGET) failures.push(`total JS is ${kb(total)} gzip (budget ${kb(TOTAL_BUDGET)})`);

if (failures.length) {
  console.error('\nBundle budget exceeded:');
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log('Bundle budget OK.');
