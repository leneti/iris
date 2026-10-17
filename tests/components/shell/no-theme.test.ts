import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const root = process.cwd();
const self = join(root, 'tests/components/shell/no-theme.test.ts');
// Built at runtime so this file does not match itself.
const words = ['next-' + 'themes', 'use' + 'Theme', 'set' + 'Theme', 'Theme' + 'Switch'];

function walk(path: string, out: string[] = []): string[] {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry), out);
  } else out.push(path);
  return out;
}

test('no source, test or package file mentions next-themes, useTheme, setTheme or ThemeSwitch', () => {
  const files = ['app', 'components', 'lib', 'tests', 'package.json']
    .flatMap((entry) => walk(join(root, entry)))
    .filter((file) => file !== self);
  const hits = files.filter((file) => {
    const text = readFileSync(file, 'utf8');
    return words.some((word) => text.includes(word));
  });
  expect(hits.map((file) => file.slice(root.length + 1))).toEqual([]);
});
