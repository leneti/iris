import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ErrorPage from '@/app/error';
import GlobalError from '@/app/global-error';

const error = Object.assign(new Error('secret detail'), { digest: 'abc123digest' });
const original = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: original });
});

describe('error pages', () => {
  test('error page has a Reload button that calls window.location.reload', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { reload } });
    render(<ErrorPage error={error} />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('global error renders its own html and body and a Reload button', () => {
    const html = renderToStaticMarkup(<GlobalError error={error} />);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(html.startsWith('<html')).toBe(true);
    expect(doc.body.textContent).toContain('Something went wrong');
    expect(doc.querySelector('button')?.textContent).toBe('Reload');
  });

  test('neither page shows the error message or digest', () => {
    const { container } = render(<ErrorPage error={error} />);
    const global = renderToStaticMarkup(<GlobalError error={error} />);
    for (const text of [container.innerHTML, global]) {
      expect(text).not.toContain('secret detail');
      expect(text).not.toContain('abc123digest');
    }
  });
});
