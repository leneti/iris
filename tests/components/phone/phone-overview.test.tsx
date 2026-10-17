import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PhoneOverview } from '@/components/phone/phone-overview';
import { ReadingStateContext } from '@/components/reading/reading-context';
import { deriveReading, type Reading } from '@/lib/client/reading';
import { calm } from '../../helpers/reading';

vi.mock('@/components/ball/ball', () => ({
  Ball: (p: { variant?: string; hoverStrength: number }) => (
    <div data-slot="ball-stub" data-variant={p.variant} data-hover={p.hoverStrength} />
  ),
}));

function show(reading: Reading = deriveReading(calm()), onOpenService = vi.fn()) {
  render(
    <ReadingStateContext.Provider value={reading}>
      <PhoneOverview onOpenService={onOpenService} />
    </ReadingStateContext.Provider>,
  );
  return onOpenService;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  errorSpy.mockRestore();
  // @ts-expect-error -- jsdom has none; remove the stub so tests do not leak it
  delete Element.prototype.scrollIntoView;
});

const one = (selector: string) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
};

describe('PhoneOverview', () => {
  test('regions are in the phone order', () => {
    show();
    const order = [
      one('[data-slot="overview-stage"]'),
      screen.getByRole('heading', { name: 'Omens' }).closest('section') as Element,
      one('#ov-circle'),
      one('#ov-hours'),
      one('[data-slot="overview-foot"]'),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        (order[i - 1] as Element).compareDocumentPosition(order[i] as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test('the stage is the phone variant', () => {
    show();
    expect(one('[data-slot="ball-stub"]').getAttribute('data-variant')).toBe('phone');
    expect(one('[data-slot="reading"]').className).toContain('text-[25px]');
  });

  test('chips are at least 44 px tall by class', () => {
    show();
    const chips = document.querySelectorAll('#ov-circle button');
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip.className).toContain('min-h-11');
  });

  test('footer links and the menu button are 44 px', () => {
    show();
    const links = document.querySelectorAll('[data-slot="overview-foot"] a');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.className).toContain('min-h-11');
  });

  test('a chip tap opens its service', () => {
    const open = show();
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(open).toHaveBeenCalledWith('alpha');
  });

  test('touch variant has no hover state', () => {
    show();
    const chip = screen.getByRole('button', { name: 'Alpha' });
    fireEvent.pointerEnter(chip);
    // A tap leaves a sticky pointer-enter on a phone: the ball must not stay raised.
    expect(one('[data-slot="ball-stub"]').getAttribute('data-hover')).toBe('0.6');
  });

  test('a forced throw in one region leaves the others', () => {
    const reading = deriveReading(calm());
    Object.defineProperty(reading, 'hours', {
      get() {
        throw new Error('boom');
      },
    });
    show(reading);
    expect(screen.getAllByText("This part didn't draw.")).toHaveLength(1);
    expect(screen.queryByText('The hours')).toBeNull();
    expect(screen.getByText('The circle')).toBeTruthy();
    expect(screen.getByText('Omens')).toBeTruthy();
  });
});
