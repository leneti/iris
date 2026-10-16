import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (name: string) => readFileSync(join(process.cwd(), 'components/ui', name), 'utf8');
const lines = (source: string, marker: string) =>
  source.split('\n').filter((l) => l.includes(marker));

describe('shadcn primitives follow the README', () => {
  test('outline button uses the control border in both themes', () => {
    const [line] = lines(read('button.tsx'), 'outline:');
    expect(line).toContain('border-input');
    expect(line).not.toContain('dark:border-input');
  });

  test.each([
    ['dropdown-menu.tsx', 2],
    ['select.tsx', 1],
  ] as const)('%s floating panels use the 6 px menu radius', (file, count) => {
    const panels = lines(read(file), 'data-[state=open]:animate-in').filter((l) =>
      l.includes('z-50'),
    );
    expect(panels).toHaveLength(count);
    for (const panel of panels) expect(panel).toContain('rounded-menu');
  });
});
