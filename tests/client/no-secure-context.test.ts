import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// Criterion 8.5: the LAN stage is plain HTTP, so none of these may appear in browser-reachable code.
const root = path.resolve(__dirname, '../..');
const dirs = ['lib/client', 'components', 'app'];
const forbidden = [/randomUUID/, /crypto\.subtle/, /navigator\.clipboard/, /serviceWorker/];
const sourceFile = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
    return sourceFile.test(e.name) ? [full] : [];
  });
}

describe('criterion 8.5: nothing needs a secure context', () => {
  const files = dirs.flatMap((d) => walk(path.join(root, d)));

  test('the scan sees the client logic', () => {
    expect(files.some((f) => f.endsWith(path.join('lib', 'client', 'tabs.ts')))).toBe(true);
  });

  test.each(forbidden.map((re) => [re.source, re] as const))('no file uses %s', (_name, re) => {
    const hits = files
      .filter((f) => re.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });
});
