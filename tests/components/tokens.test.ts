import { readdirSync, readFileSync, statSync } from 'node:fs';
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

// name, light value, dark value: every colour row of mockups/README.md.
const TOKENS: ReadonlyArray<readonly [string, string, string]> = [
  ['page', '#F1F5F9', '#0B1120'],
  ['chrome', '#F8FAFC', '#0F172A'],
  ['raised', '#FFFFFF', '#1B2336'],
  ['hover', '#EDF1F6', '#1A2438'],
  ['hover-raised', '#F1F5F9', '#232D42'],
  ['selected', '#E2E8F0', '#2A3447'],
  ['selected-raised', '#E2E8F0', '#303B52'],
  ['hairline', '#E2E8F0', '#1E293B'],
  ['hairline-raised', '#E2E8F0', '#2B3549'],
  ['hairline-strong', '#CBD5E1', '#334155'],
  ['control', '#7C8BA1', '#64748B'],
  ['text', '#0F172A', '#F8FAFC'],
  ['text-2', '#475569', '#A8B3C5'],
  ['text-3', '#5F6E84', '#8E9BB0'],
  ['accent', '#2563EB', '#2563EB'],
  ['accent-contrast', '#FFFFFF', '#FFFFFF'],
  ['accent-mark', '#2563EB', '#60A5FA'],
  ['accent-text', '#1D4ED8', '#93C5FD'],
  ['scrim', 'rgb(15 23 42 / 0.28)', 'rgb(2 6 23 / 0.6)'],
  ['tooltip', '#0F172A', '#F1F5F9'],
  ['tooltip-text', '#F8FAFC', '#0F172A'],
  ['status-healthy', '#15803D', '#22C55E'],
  ['status-healthy-text', '#166534', '#4ADE80'],
  ['status-starting', '#0E7490', '#22D3EE'],
  ['status-starting-text', '#155E75', '#67E8F9'],
  ['status-degraded', '#B45309', '#F59E0B'],
  ['status-degraded-text', '#92400E', '#FBBF24'],
  ['status-unhealthy', '#DC2626', '#EF4444'],
  ['status-unhealthy-text', '#B91C1C', '#FCA5A5'],
  ['status-stopped', '#475569', '#94A3B8'],
  ['status-stopped-text', '#475569', '#94A3B8'],
  ['status-unknown', '#64748B', '#7C8BA1'],
  ['status-unknown-text', '#64748B', '#7C8BA1'],
  ['status-on-solid', '#FFFFFF', '#0B1120'],
  ['meter-track', '#CBD5E1', '#2B3549'],
  ['meter-normal', '#475569', '#A8B3C5'],
  ['meter-warning', '#B45309', '#F59E0B'],
  ['meter-critical', '#DC2626', '#EF4444'],
  // Added with the 2026-10-17 Overview redesign: the recessed strip that holds a card's figures.
  ['well', '#F4F7FA', '#141C2C'],
];

describe('theme tokens', () => {
  const light = block(css, '@theme static');
  const dark = block(css, '.dark {');

  test('declares the class-based dark variant', () => {
    expect(css).toContain('@custom-variant dark (&:where(.dark, .dark *));');
  });

  test.each(TOKENS)(
    '--color-%s has its README value in both themes',
    (name, lightValue, darkValue) => {
      expect(declared(light, `--color-${name}`)).toBe(lightValue.toLowerCase());
      expect(declared(dark, `--color-${name}`)).toBe(darkValue.toLowerCase());
    },
  );

  test('declares the radius scale', () => {
    for (const [name, value] of [
      ['row', '4px'],
      ['tile', '5px'],
      ['menu', '6px'],
      ['panel', '8px'],
      ['sheet', '12px'],
    ] as const) {
      expect(declared(light, `--radius-${name}`)).toBe(value);
    }
  });

  test('wires the next/font variables into the font theme', () => {
    expect(light).toMatch(/--font-sans\s*:\s*var\(--font-inter\)/);
    expect(light).toMatch(/--font-mono\s*:\s*var\(--font-jetbrains-mono\)/);
  });

  test('stops animation and transitions under reduced motion', () => {
    const media = block(css, '@media (prefers-reduced-motion: reduce)');
    expect(media).toMatch(/animation\s*:\s*none/);
    expect(media).toMatch(/transition\s*:\s*none/);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(css|ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

describe('flat look (criterion 6.1)', () => {
  // Built at runtime so this file does not trip its own scan.
  const banned = ['gradi' + 'ent', 'backdrop-' + 'filter', 'backdrop-' + 'blur', 'bg-' + 'opacity'];
  const files = ['app', 'components', 'lib'].flatMap((dir) => walk(join(root, dir)));

  test('scans the repo own sources', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((file) => file.endsWith('globals.css'))).toBe(true);
  });

  test.each(banned)('no source file contains %s', (word) => {
    const hits = files.filter((file) => readFileSync(file, 'utf8').toLowerCase().includes(word));
    expect(hits).toEqual([]);
  });

  test('no translucent bg, ring or border colours (opacity modifiers)', () => {
    const modifier = /\b(?:bg|ring|border)-[\w-]+\/\d+/;
    const hits = ['app', 'components']
      .flatMap((dir) => walk(join(root, dir)))
      .filter((file) => modifier.test(readFileSync(file, 'utf8')));
    expect(hits).toEqual([]);
  });

  test('package.json has no animation library', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const names = ['dependencies', 'devDependencies'].flatMap((key) =>
      Object.keys((pkg[key] as Record<string, string> | undefined) ?? {}),
    );
    expect(names).not.toContain('motion');
    expect(names).not.toContain('framer-motion');
  });
});
