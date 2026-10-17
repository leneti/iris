import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Overview } from '@/components/overview/overview';
import { ReadingStateContext } from '@/components/reading/reading-context';
import { deriveReading, type Reading, type ReadingInput } from '@/lib/client/reading';
import {
  calm,
  withDown,
  withJob,
  withServices,
  withStatus,
  withSystem,
} from '../../helpers/reading';

const ball = vi.hoisted(() => ({ throws: false }));

vi.mock('@/components/ball/ball', () => ({
  Ball: (p: { hoverStrength: number; color: string }) => {
    if (ball.throws) throw new Error('ball');
    return <div data-slot="ball-stub" data-hover={p.hoverStrength} data-color={p.color} />;
  },
}));

const read = (input: ReadingInput = calm()): Reading => deriveReading(input);

function show(reading: Reading = read(), onOpenService: (id: string) => void = vi.fn()) {
  return render(
    <ReadingStateContext.Provider value={reading}>
      <Overview onOpenService={onOpenService} />
    </ReadingStateContext.Provider>,
  );
}

const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`) as HTMLElement;
const stub = () => slot('ball-stub');

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  ball.throws = false;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  errorSpy.mockRestore();
  // @ts-expect-error -- jsdom has none; remove the stub so tests do not leak it
  delete Element.prototype.scrollIntoView;
  window.location.hash = '';
});

describe('chips', () => {
  test('a chip click opens its tab', () => {
    const open = vi.fn();
    show(read(), open);
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(open).toHaveBeenCalledWith('alpha');
  });

  test('a down chip reads down', () => {
    show(read(withDown(calm(), 'alpha')));
    const chip = screen.getByRole('button', { name: 'Alpha, down' });
    const word = within(chip).getByText('down');
    expect(word.className).toContain('text-down');
    expect(chip.className).toContain('border-down');
  });

  test('a degraded chip is named degraded', () => {
    show(read(withStatus(calm(), 'alpha', 'degraded')));
    expect(screen.getByRole('button', { name: 'Alpha, degraded' })).toBeTruthy();
  });

  test('hovering a chip raises the ball to 1 and leaving returns to 0.6', () => {
    show();
    expect(stub().dataset.hover).toBe('0.6');
    const chip = screen.getByRole('button', { name: 'Alpha' });
    fireEvent.pointerEnter(chip);
    expect(stub().dataset.hover).toBe('1');
    fireEvent.pointerLeave(chip);
    expect(stub().dataset.hover).toBe('0.6');
  });

  test('focusing a chip does too', () => {
    show();
    const chip = screen.getByRole('button', { name: 'Alpha' });
    fireEvent.focus(chip);
    expect(stub().dataset.hover).toBe('1');
    fireEvent.blur(chip);
    expect(stub().dataset.hover).toBe('0.6');
  });
});

describe('the reading', () => {
  const all = () =>
    withSystem(withJob(withDown(calm(), 'alpha'), 'feed-sync', { result: 'failed' }), { cpu: 90 });

  test("the reading's targets are focusable", () => {
    show(read(all()));
    const targets = slot('reading').querySelectorAll('a, button');
    expect(targets.length).toBeGreaterThan(2);
    for (const t of targets)
      expect(Number(t.getAttribute('tabindex') ?? 0)).toBeGreaterThanOrEqual(0);
  });

  test('a fact segment is underlined, a bad one is coral, a strain one is amber', () => {
    show(read(all()));
    const fact = screen.getByText('2 of your 3');
    expect(fact.className).toContain('underline');
    expect(fact.className).toContain('text-pink-soft');
    const bad = screen.getByText('Alpha has fallen silent');
    expect(bad.className).toContain('text-down');
    expect(bad.className).toContain('italic');
    expect(bad.className).toContain('underline');
    const strain = screen.getByText(/^straining:/);
    expect(strain.className).toContain('text-warn');
    expect(strain.className).toContain('underline');
  });

  test('an anchor target scrolls and focuses its region and leaves location.hash alone', () => {
    show(read(withJob(calm(), 'feed-sync', { result: 'failed' })));
    const link = screen.getByText(/^feed-sync failed at/);
    expect(link.getAttribute('href')).toBe('#ov-hours');
    fireEvent.click(link);
    const region = document.getElementById('ov-hours');
    expect(region?.getAttribute('tabindex')).toBe('-1');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(region);
    expect(window.location.hash).toBe('');
  });

  test('a tab target opens the service', () => {
    const open = vi.fn();
    show(read(withDown(calm(), 'alpha')), open);
    fireEvent.click(screen.getByRole('button', { name: 'Alpha has fallen silent' }));
    expect(open).toHaveBeenCalledWith('alpha');
  });

  test('a job link that is http opens in a new tab with rel; one that is not becomes the hours anchor', () => {
    show(
      read(
        withJob(calm(), 'feed-sync', { result: 'failed', link: 'https://jobs.example.invalid/x' }),
      ),
    );
    const link = screen.getByText(/^feed-sync failed at/);
    expect(link.getAttribute('href')).toBe('https://jobs.example.invalid/x');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  test('a segment with an unsafe href is inert text, not a link', () => {
    const reading = read(withJob(calm(), 'feed-sync', { result: 'failed' }));
    const segments = reading.segments.map((s) =>
      s.kind === 'bad' ? { ...s, target: { href: 'javascript:alert(1)' } } : s,
    );
    show({ ...reading, segments });
    const text = screen.getByText(/^feed-sync failed at/);
    expect(text.closest('a')).toBeNull();
    expect(text.tagName).not.toBe('BUTTON');
  });

  test('blind reading says "I can\'t see the services right now."', () => {
    show(read(calm({ unavailable: new Set(['status']) })));
    expect(screen.getByText(/I can't see the services right now\./)).toBeTruthy();
  });

  test('pending shows "Reading the signs…"', () => {
    show(read(calm({ services: undefined })));
    expect(screen.getByText('Reading the signs…')).toBeTruthy();
  });
});

describe('the stage', () => {
  test('eyebrow, haze and bars turn coral when wrong', () => {
    show(read(withDown(calm(), 'alpha')));
    expect(slot('eyebrow').textContent).toBe('a disturbance');
    expect(slot('eyebrow').className).toContain('text-down');
    expect(slot('haze').className).toContain('255_110_122');
    for (const bar of document.querySelectorAll('[data-slot="meter-fill"]')) {
      expect(bar.className).toContain('bg-down');
    }
    expect(stub().dataset.color).toBe('#ff7a6b');
  });

  test('eyebrow, haze and bars are pink when well', () => {
    show();
    expect(slot('eyebrow').textContent).toBe('the reading');
    expect(slot('eyebrow').className).toContain('text-pink-soft');
    expect(slot('haze').className).toContain('242_91_208');
    for (const bar of document.querySelectorAll('[data-slot="meter-fill"]')) {
      expect(bar.className).toContain('bg-pink');
    }
  });

  test('meters read colour 3/4 well · 1 failed', () => {
    show(read(withJob(withDown(calm(), 'alpha'), 'feed-sync', { result: 'failed' })));
    expect(screen.getByText('3/4 well · 1 failed')).toBeTruthy();
    expect(screen.getByText('crackle · cpu')).toBeTruthy();
    expect(screen.getByText('dust · memory')).toBeTruthy();
  });

  test('an over-threshold figure is amber', () => {
    show(read(withSystem(calm(), { cpu: 84 })));
    expect(screen.getByText('84%').className).toContain('text-warn');
    expect(screen.getByText('61%').className).not.toContain('text-warn');
  });

  test('a long reading takes text-[26px]', () => {
    show({ ...read(), long: true });
    expect(slot('reading').className).toContain('text-[26px]');
  });

  test('a short reading is 30 px on desktop', () => {
    show();
    expect(slot('reading').className).toContain('lg:text-[30px]');
    expect(slot('reading').className).not.toContain('text-[26px]');
  });
});

describe('the circle', () => {
  test('groups chips, drops empty groups and shares one row among consecutive single-service groups', () => {
    show(
      read(
        withServices(calm(), [
          ['Media', ['alpha', 'beta']],
          ['Ghost', ['~delta']],
          ['Solo1', ['gamma']],
          ['Solo2', ['epsilon']],
          ['Solo3', ['zeta']],
        ]),
      ),
    );
    expect(screen.queryByText('Ghost')).toBeNull();
    expect(screen.getByText('Media')).toBeTruthy();
    const pairs = document.querySelectorAll('[data-slot="pair"]');
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.querySelectorAll('[data-slot="group"]').length).toBe(3);
    expect(screen.getByText('5 shown')).toBeTruthy();
  });
});

describe('the hours', () => {
  test('maintenance, gap in words, now marker, user jobs', () => {
    show();
    const hours = document.getElementById('ov-hours') as HTMLElement;
    const text = hours.textContent ?? '';
    expect(text).toContain('nightly-backup');
    expect(text).toContain('02:30');
    expect(within(hours).getByText('ok')).toBeTruthy();
    expect(within(hours).getByText(/quiet hours?$/)).toBeTruthy();
    expect(within(hours).getByText('now')).toBeTruthy();
    expect(within(hours).getByText('feed-sync')).toBeTruthy();
    expect(within(hours).getByText('last 11:15')).toBeTruthy();
    expect(text.indexOf('nightly-backup')).toBeLessThan(text.indexOf('now'));
    expect(text.indexOf('now')).toBeLessThan(text.indexOf('feed-sync'));
  });

  test('a failed job is red with "failed"', () => {
    show(read(withJob(calm(), 'nightly-backup', { result: 'failed' })));
    const hours = document.getElementById('ov-hours') as HTMLElement;
    const note = within(hours).getByText('failed');
    expect(note.className).toContain('text-down');
    expect(within(hours).getByText('nightly-backup').className).toContain('text-down');
  });

  test('a failed user job is red too', () => {
    show(read(withJob(calm(), 'feed-sync', { result: 'failed' })));
    const hours = document.getElementById('ov-hours') as HTMLElement;
    expect(within(hours).getByText('feed-sync').className).toContain('text-down');
    expect(within(hours).getByText(/^failed \d\d:\d\d$/).className).toContain('text-down');
  });
});

describe('the omens', () => {
  test('render in the order markets, host, sky with rose/fell colours and margin-right .3em', () => {
    show();
    const order = ['Markets · 24h', 'The host', 'The sky'].map(
      (t) => screen.getByText(t) as HTMLElement,
    );
    expect(order[0]?.compareDocumentPosition(order[1] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(order[1]?.compareDocumentPosition(order[2] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const rose = screen.getByText('rose 1.20%');
    expect(rose.className).toContain('text-ok');
    expect(rose.className).toContain('mr-[.3em]');
    expect(screen.getByText('fell 0.50%').className).toContain('text-down');
    expect(document.getElementById('ov-host')?.textContent).toContain('Calm: ');
    expect(document.getElementById('ov-sky')?.textContent).toContain('Cloudy over Hometown');
  });
});

describe('the footer', () => {
  const withLinks = (links: { name: string; url: string }[]) => {
    const input = calm();
    return {
      ...input,
      services: input.services && {
        ...input.services,
        links: links.map((l) => ({ ...l, abbr: l.name.slice(0, 2) })),
      },
    };
  };

  test('lists safe links and the quiet names; a link with an unsafe scheme is not rendered as a link', () => {
    show(
      read(
        withLinks([
          { name: 'Example Wiki', url: 'https://wiki.example.invalid/' },
          { name: 'Sneaky', url: 'javascript:alert(1)' },
        ]),
      ),
    );
    const wiki = screen.getByText('Example Wiki');
    expect(wiki.closest('a')?.getAttribute('href')).toBe('https://wiki.example.invalid/');
    expect(wiki.closest('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    const sneaky = screen.getByText('Sneaky');
    expect(sneaky.closest('a')).toBeNull();
    expect(screen.getByText(/more are watched quietly:/)).toBeTruthy();
    expect(screen.getByText('Delta')).toBeTruthy();
  });

  test('no footer quiet line when nothing is hidden', () => {
    show(read(withServices(calm(), [['Media', ['alpha', 'beta']]])));
    expect(screen.queryByText(/watched quietly:/)).toBeNull();
  });
});

describe('unavailable sources', () => {
  test('show their quiet lines', () => {
    show(read(calm({ unavailable: new Set(['services']) })));
    expect(screen.getByText('The circle — not answering')).toBeTruthy();
  });

  test('hours, host, sky and markets', () => {
    show(read(calm({ unavailable: new Set(['cron', 'system', 'widgets']) })));
    expect(screen.getByText("the schedule isn't answering")).toBeTruthy();
    expect(screen.getByText('The sky — not answering')).toBeTruthy();
    expect(screen.getByText('not answering')).toBeTruthy();
    expect(screen.getByText('Markets · 24h')).toBeTruthy();
    expect(document.getElementById('ov-host')?.textContent).toContain('—');
  });
});

describe('resilience', () => {
  const regions = {
    stage: { key: 'segments', marker: () => screen.queryByText('the reading') },
    circle: { key: 'circle', marker: () => screen.queryByText('The circle') },
    hours: { key: 'hours', marker: () => screen.queryByText('The hours') },
    omens: { key: 'omens', marker: () => screen.queryByText('Omens') },
    foot: { key: 'foot', marker: () => screen.queryByText('Example Wiki') },
  } as const;

  test.each(Object.keys(regions) as (keyof typeof regions)[])(
    'a forced throw in %s leaves the others rendered',
    (name) => {
      const reading = read();
      Object.defineProperty(reading, regions[name].key, {
        get() {
          throw new Error('boom');
        },
      });
      show(reading);
      expect(screen.getAllByText("This part didn't draw.").length).toBe(1);
      for (const [other, r] of Object.entries(regions)) {
        if (other === name) expect(r.marker()).toBeNull();
        else expect(r.marker()).not.toBeNull();
      }
    },
  );

  test('a throwing ball falls back to the static ball', () => {
    ball.throws = true;
    show();
    expect(slot('static-ball')).not.toBeNull();
    expect(screen.queryByText("This part didn't draw.")).toBeNull();
    expect(slot('reading')).not.toBeNull();
  });
});

describe('layout', () => {
  test('the desktop grid fits without clipping', () => {
    const { container } = show();
    expect(container.firstElementChild?.className).toContain('lg:overflow-hidden');
    expect(container.firstElementChild?.className).toContain('lg:grid-cols-[620px_minmax(0,1fr)]');
    expect(slot('overview-hero').className).toContain('lg:overflow-y-auto');
    expect(slot('overview-rest').className).toContain('lg:overflow-y-auto');
    expect(slot('overview-two').className).toContain('grid');
  });

  test('no Now playing, no old panels', () => {
    show();
    expect(screen.queryByText('Now playing')).toBeNull();
    expect(screen.queryByText('System')).toBeNull();
  });
});
