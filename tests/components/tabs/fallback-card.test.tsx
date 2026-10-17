import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FallbackCard } from '@/components/tabs/fallback-card';
import { frameModel, type FrameModel } from '@/components/tabs/frame-model';
import type { ServiceEntry } from '@/lib/shared/contract';
import { svc } from '../shell/fixtures';

const torrent: ServiceEntry = {
  ...svc('t', 'Torrent Client', 'Downloads'),
  url: 'https://torrent.example.invalid/',
  lan: null,
  embed: {
    mode: 'auto',
    verdict: 'blocked',
    reason: 'x-frame-options',
    checkedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
};
const ctx = {
  mode: 'zone',
  hostname: 'iris.example.invalid',
  protocol: 'https:',
  alwaysNewTab: false,
} as const;

function card(model: FrameModel, over: Partial<Parameters<typeof FallbackCard>[0]> = {}) {
  const props = {
    model,
    status: 'healthy' as const,
    alwaysNewTab: false,
    onAlwaysNewTab: vi.fn(),
    onCheckAgain: vi.fn(),
    onSignedIn: vi.fn(),
    ...over,
  };
  render(<FallbackCard {...props} />);
  return props;
}

beforeEach(() => localStorage.clear());

describe('FallbackCard', () => {
  test('a service with no address at all in zone mode reads "Home network only", like the strip', () => {
    card(frameModel({ ...torrent, url: null, lan: null }, ctx));
    expect(screen.getByRole('heading', { name: /on the home network only/ })).toBeTruthy();
  });

  test('names the reason, the header, the address, the check time and the actions', () => {
    card(frameModel(torrent, ctx));
    expect(
      screen.getByRole('heading', { name: /Torrent Client can.t be shown here/ }),
    ).toBeTruthy();
    expect(screen.getByText(/Downloads · Healthy/)).toBeTruthy();
    expect(screen.getByText(/X-Frame-Options/)).toBeTruthy();
    expect(screen.getByRole('article').textContent).toContain('https://torrent.example.invalid/');
    expect(screen.getByText(/Checked 2 min ago/)).toBeTruthy();
    const open = screen.getByRole('link', { name: 'Open in new tab' });
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    expect(open.getAttribute('href')).toBe('https://torrent.example.invalid/');
    expect(screen.getByRole('button', { name: 'Sign in and retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  test('"Check again" calls the re-fetch', () => {
    const props = card(frameModel(torrent, ctx));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(props.onCheckAgain).toHaveBeenCalledTimes(1);
  });

  test('the per-device switch reports its new value', () => {
    const props = card(frameModel(torrent, ctx));
    const toggle = screen.getByRole('switch', { name: /Always open Torrent Client in a new tab/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(props.onAlwaysNewTab).toHaveBeenCalledWith(true);
  });

  test('a LAN address has no "Sign in and retry"', () => {
    const lan = { ...torrent, lan: { port: 47489, path: '/', source: 'label' as const } };
    card(frameModel(lan, { ...ctx, mode: 'lan', hostname: '127.0.0.1', protocol: 'http:' }));
    expect(screen.queryByRole('button', { name: 'Sign in and retry' })).toBeNull();
    expect(screen.getByRole('article').textContent).toContain('http://127.0.0.1:47489/');
  });

  test('mixed content: an https page and an http address', () => {
    const lan = {
      ...svc('m', 'Mixed'),
      embed: { ...torrent.embed, verdict: 'allowed' as const, reason: null },
    };
    card(frameModel(lan, { ...ctx, mode: 'lan', hostname: '192.0.2.10', protocol: 'https:' }));
    expect(screen.getByText(/plain HTTP/)).toBeTruthy();
  });

  test('a zone-mode service with only a LAN port reads "Home network only"', () => {
    const homeOnly = {
      ...torrent,
      url: null,
      lan: { port: 47489, path: '/', source: 'label' as const },
    };
    card(frameModel(homeOnly, ctx));
    expect(screen.getByText(/Home network only/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open in new tab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  test('a service the device always opens in a new tab shows the card too', () => {
    const allowed = svc('a', 'Alpha');
    card(frameModel(allowed, { ...ctx, alwaysNewTab: true }), { alwaysNewTab: true });
    expect(screen.getByText(/You chose to open Alpha/)).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: /Always open Alpha/ }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  test('"Copy link" in the card selects the address in a read-only field', () => {
    card(frameModel(torrent, ctx));
    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Copy link' }));
    const field = screen.getByRole('textbox', { name: 'Link' }) as HTMLInputElement;
    expect(field.value).toBe('https://torrent.example.invalid/');
  });
});
