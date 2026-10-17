import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentView } from '@/components/overview/stage';

describe('SegmentView', () => {
  const segment = {
    text: 'Moviebox has fallen silent',
    kind: 'bad' as const,
    target: { tab: 'alpha' },
  };

  it('renders a tab target as inline text, not a native button, so no line breaks before the comma after it', () => {
    render(<SegmentView segment={segment} onOpenService={() => {}} />);
    const el = screen.getByRole('button', { name: 'Moviebox has fallen silent' });
    expect(el.tagName).toBe('SPAN');
    expect(el.className.split(/\s+/)).not.toContain('inline-block');
  });

  it('opens the service on click, Enter and Space, and is focusable', () => {
    const open = vi.fn();
    render(<SegmentView segment={segment} onOpenService={open} />);
    const el = screen.getByRole('button', { name: 'Moviebox has fallen silent' });
    expect(el.tabIndex).toBe(0);
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'a' });
    expect(open).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenCalledWith('alpha');
  });
});
