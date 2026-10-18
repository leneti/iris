// `yarn cls [url]`: Cumulative Layout Shift of a running Iris, at a desktop and a phone viewport.
// Run against a production build (`yarn build && yarn start`), not `next dev`: dev is not realistic.
// Uses a Chromium already on disk (never downloads one): IRIS_CLS_CHROMIUM, else the newest in
// the Playwright cache (PLAYWRIGHT_BROWSERS_PATH or ~/.cache/ms-playwright).
// IRIS_CLS_MAX sets the limit (default 0.05); the exit code is 1 when a viewport is above it, or
// when a page throws or logs a console error (a hydration mismatch is one: React error #418).
// Each context starts with no cookies and a browser time zone (IRIS_CLS_TIMEZONE, default
// Pacific/Auckland) that is not the server's, so the first-visit greeting must hydrate cleanly.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContextOptions } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:3100/';
const max = Number(process.env.IRIS_CLS_MAX ?? '0.05');
const SETTLE_MS = 2000;
const timezoneId = process.env.IRIS_CLS_TIMEZONE ?? 'Pacific/Auckland';

type Shift = { value: number; at: number; nodes: { selector: string; value: number }[] };

const viewports: { name: string; options: BrowserContextOptions }[] = [
  { name: 'desktop 1440x900', options: { viewport: { width: 1440, height: 900 }, timezoneId } },
  {
    name: 'phone 390x844',
    options: {
      viewport: { width: 390, height: 844 },
      timezoneId,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    },
  },
];

function findChromium(): string {
  const fromEnv = process.env.IRIS_CLS_CHROMIUM;
  if (fromEnv) return fromEnv;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache', 'ms-playwright');
  const found: { revision: number; path: string }[] = [];
  if (existsSync(root)) {
    for (const dir of readdirSync(root)) {
      const m = /^chromium-(\d+)$/.exec(dir);
      const path = join(root, dir, 'chrome-linux64', 'chrome');
      if (m && existsSync(path)) found.push({ revision: Number(m[1]), path });
    }
  }
  const best = found.sort((a, b) => b.revision - a.revision)[0];
  if (!best) throw new Error(`No Chromium under ${root}. Set IRIS_CLS_CHROMIUM to a binary.`);
  return best.path;
}

// Runs in the page before any script. Selectors are taken when the shift happens: a node that is
// replaced later would otherwise be gone from the entry.
function observe(): void {
  const w = window as unknown as { __shifts: Shift[] };
  w.__shifts = [];
  const describe = (node: Node | null): string => {
    let el = node instanceof Element ? node : (node?.parentElement ?? null);
    if (!el) return '(gone)';
    const slot = el.closest('[data-slot]');
    if (slot) return `[data-slot=${slot.getAttribute('data-slot')}]`;
    const parts: string[] = [];
    for (let i = 0; el && i < 3 && el !== document.body; i += 1, el = el.parentElement) {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
      parts.unshift(el.tagName.toLowerCase() + id + (cls && !id ? `.${cls}` : ''));
    }
    return parts.join(' > ');
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const entry = e as PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources?: {
          node: Node | null;
          previousRect: DOMRectReadOnly;
          currentRect: DOMRectReadOnly;
        }[];
      };
      if (entry.hadRecentInput) continue;
      const nodes = (entry.sources ?? []).map((s) => ({
        selector: describe(s.node),
        // Rough share: the moved area is not what Chrome scores, so rank by distance moved.
        value:
          Math.abs(s.currentRect.top - s.previousRect.top) +
          Math.abs(s.currentRect.left - s.previousRect.left),
      }));
      w.__shifts.push({ value: entry.value, at: Math.round(entry.startTime), nodes });
    }
  }).observe({ type: 'layout-shift', buffered: true });
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
let failed = false;
try {
  console.log(`CLS for ${url} (limit ${max})`);
  for (const { name, options } of viewports) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
    });
    await page.addInitScript(observe);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(SETTLE_MS);
    const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
    await context.close();

    const cls = shifts.reduce((sum, s) => sum + s.value, 0);
    const over = cls > max;
    failed ||= over || problems.length > 0;
    console.log(
      `\n${name}: CLS ${cls.toFixed(4)} ${over ? 'FAIL' : 'ok'} (${shifts.length} shifts)`,
    );
    const byNode = new Map<string, number>();
    for (const s of shifts) {
      // A shift's score is split over its nodes by distance moved.
      const total = s.nodes.reduce((sum, n) => sum + n.value, 0) || 1;
      for (const n of s.nodes)
        byNode.set(n.selector, (byNode.get(n.selector) ?? 0) + (s.value * n.value) / total);
    }
    for (const [selector, value] of [...byNode].sort((a, b) => b[1] - a[1]).slice(0, 8))
      console.log(`  ${value.toFixed(4)}  ${selector}`);
    for (const problem of problems) console.log(`  FAIL ${problem.slice(0, 300)}`);
    for (const s of shifts.slice(0, 5))
      console.log(
        `  @${s.at}ms ${s.value.toFixed(4)} ${s.nodes.map((n) => n.selector).join(', ')}`,
      );
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
