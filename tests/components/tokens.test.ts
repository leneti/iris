import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

/** The body of the first block that starts with `opener`, matched by brace depth. */
function block(source: string, opener: string): string {
  const start = source.indexOf(opener);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, i);
  }
  return '';
}

function declared(body: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body);
  return match?.[1]?.trim().toLowerCase();
}

const TOKENS: ReadonlyArray<readonly [string, string]> = [
  ['bg', '#0b0710'],
  ['surface', '#150e1b'],
  ['surface-2', '#1e1526'],
  ['line', '#2e2236'],
  ['line-strong', '#46344f'],
  ['text', '#f7eef6'],
  ['muted', '#b7a5b8'],
  ['faint', '#8d7b8f'],
  ['pink', '#f25bd0'],
  ['pink-soft', '#ff9fe6'],
  ['pink-glow', 'rgb(242 91 208 / 0.28)'],
  ['pink-wash', 'rgb(242 91 208 / 0.08)'],
  ['on-pink', '#1a0716'],
  ['ok', '#5fe3a1'],
  ['warn', '#ffc65c'],
  ['down', '#ff6e7a'],
];

const LEGACY =
  'page chrome raised hover hover-raised selected selected-raised hairline hairline-raised hairline-strong control text-2 text-3 accent accent-contrast accent-mark accent-text scrim tooltip tooltip-text status-healthy status-healthy-text status-starting status-starting-text status-degraded status-degraded-text status-unhealthy status-unhealthy-text status-stopped status-stopped-text status-unknown status-unknown-text status-on-solid meter-track meter-normal meter-warning meter-critical well'.split(
    ' ',
  );

describe('theme tokens', () => {
  const theme = block(css, '@theme static');

  test.each(TOKENS)('--color-%s is %s', (name, value) => {
    expect(declared(theme, `--color-${name}`)).toBe(value.toLowerCase());
  });

  test('declares no .dark block and no custom-variant dark', () => {
    expect(css).not.toContain('.dark {');
    expect(css).not.toContain('@custom-variant');
  });

  test('html sets color-scheme: dark', () => {
    expect(block(css, 'html {')).toMatch(/color-scheme\s*:\s*dark/);
  });

  test('body paints --color-bg with --color-text at 14px', () => {
    const body = block(css, 'body {');
    expect(body).toMatch(/background-color\s*:\s*var\(--color-bg\)/);
    expect(body).toMatch(/color\s*:\s*var\(--color-text\)/);
    expect(body).toMatch(/font-size\s*:\s*14px/);
  });

  test('wires the next/font variables', () => {
    expect(theme).toMatch(/--font-sans\s*:\s*var\(--font-inter\)/);
    expect(theme).toMatch(/--font-mono\s*:\s*var\(--font-jetbrains-mono\)/);
    expect(theme).toMatch(/--font-display\s*:\s*var\(--font-space-grotesk\)/);
    expect(theme).toMatch(/--font-serif\s*:\s*var\(--font-instrument-serif\)/);
  });

  test.each(LEGACY)('keeps legacy token --color-%s declared', (name) => {
    expect(declared(theme, `--color-${name}`)).toBeDefined();
  });

  test('declares the radius scale', () => {
    for (const [name, value] of [
      ['row', '4px'],
      ['tile', '5px'],
      ['menu', '6px'],
      ['panel', '8px'],
      ['sheet', '12px'],
    ] as const) {
      expect(declared(theme, `--radius-${name}`)).toBe(value);
    }
  });

  test('stops animation and transitions under reduced motion', () => {
    const media = block(css, '@media (prefers-reduced-motion: reduce)');
    expect(media).toMatch(/animation\s*:\s*none/);
    expect(media).toMatch(/transition\s*:\s*none/);
  });
});
