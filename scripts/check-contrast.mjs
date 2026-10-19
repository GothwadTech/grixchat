// WCAG 2.x contrast check for the theme colour pairs in src/index.css.
// Usage: node scripts/check-contrast.mjs   (exit 1 if any pair is below 4.5:1)
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const themes = {};
for (const block of css.matchAll(/(:root|\[data-theme=['"]?dark['"]?\])\s*\{([^}]*)\}/g)) {
  const name = block[1];
  themes[name] ??= {};
  for (const m of block[2].matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\s*;/g)) {
    themes[name][m[1]] = m[2];
  }
}

const lum = (hex) => {
  const h = hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Text-on-surface pairs that the UI actually uses.
const PAIRS = [
  ['text-primary', 'bg-main'], ['text-secondary', 'bg-main'], ['text-primary', 'bg-card'],
  ['header-text', 'header-bg'], ['nav-text', 'nav-bg'], ['box-text', 'box-bg'],
  ['bubble-text-own', 'bubble-own'], ['bubble-text-other', 'bubble-other'],
  ['primary-foreground', 'primary'],
];

let failed = 0;
for (const [name, vars] of Object.entries(themes)) {
  if (!vars['bg-main']) continue;
  for (const [fg, bg] of PAIRS) {
    if (!vars[fg] || !vars[bg]) continue;
    const r = ratio(vars[fg], vars[bg]);
    const ok = r >= 4.5;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(12)} ${fg} on ${bg}: ${r.toFixed(2)}:1`);
  }
}
if (failed) { console.error(`${failed} pair(s) below 4.5:1`); process.exit(1); }
console.log('All checked pairs meet 4.5:1.');
