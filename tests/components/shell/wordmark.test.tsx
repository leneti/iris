import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ReadingStateContext } from '@/components/reading/reading-context';
import { Wordmark } from '@/components/shell/wordmark';
import type { Reading } from '@/lib/client/reading';

const mark = () => document.querySelector('[data-slot="wordmark-i"]') as HTMLElement;

describe('Wordmark', () => {
  test('reads iris', () => {
    render(<Wordmark />);
    expect(screen.getByText('ir', { exact: false }).parentElement?.textContent).toBe('iris');
  });

  test('the second i is pink', () => {
    render(<Wordmark />);
    expect(mark().textContent).toBe('i');
    expect(mark().className).toContain('text-pink');
    expect(mark().className).not.toContain('text-down');
  });

  test('the second i is coral when the reading is wrong', () => {
    render(
      <ReadingStateContext.Provider value={{ wrong: true } as Reading}>
        <Wordmark />
      </ReadingStateContext.Provider>,
    );
    expect(mark().className).toContain('text-down');
  });

  test('renders without a provider', () => {
    expect(() => render(<Wordmark className="x" />)).not.toThrow();
  });
});
