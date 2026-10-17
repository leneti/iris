import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import { SectionBoundary } from '@/components/section-boundary';

let errorSpy: MockInstance<typeof console.error>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

function Boom(): never {
  throw new Error('boom');
}

describe('SectionBoundary', () => {
  test('renders its children', () => {
    render(
      <SectionBoundary name="hours">
        <p>fine</p>
      </SectionBoundary>,
    );
    expect(screen.getByText('fine')).toBeTruthy();
  });

  test('a throwing child renders "This part didn\'t draw." and a Try again button, and logs the section name', () => {
    render(
      <SectionBoundary name="hours">
        <Boom />
      </SectionBoundary>,
    );
    expect(screen.getByText("This part didn't draw.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    const logged = errorSpy.mock.calls.some((c) => c[0] === '[iris]' && c[1] === 'hours');
    expect(logged).toBe(true);
  });

  test('its siblings keep rendering', () => {
    render(
      <div>
        <SectionBoundary name="a">
          <Boom />
        </SectionBoundary>
        <SectionBoundary name="b">
          <p>sibling</p>
        </SectionBoundary>
      </div>,
    );
    expect(screen.getByText('sibling')).toBeTruthy();
  });

  test('Try again renders the children again', () => {
    let broken = true;
    function Flaky() {
      if (broken) throw new Error('once');
      return <p>recovered</p>;
    }
    render(
      <SectionBoundary name="omens">
        <Flaky />
      </SectionBoundary>,
    );
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered')).toBeTruthy();
  });

  test('a given fallback replaces the quiet message', () => {
    render(
      <SectionBoundary name="x" fallback={<p>custom</p>}>
        <Boom />
      </SectionBoundary>,
    );
    expect(screen.getByText('custom')).toBeTruthy();
    expect(screen.queryByText("This part didn't draw.")).toBeNull();
  });
});
