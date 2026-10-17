import { isDiscoveryReady, shownGroups } from '@/lib/client/services';
import { group, servicesResponse, svc } from '../components/shell/fixtures';

describe('isDiscoveryReady', () => {
  const full = servicesResponse([group('Media', [svc('a', 'Alpha')])]);
  test('a complete response is ready', () => {
    expect(isDiscoveryReady(full)).toBe(true);
  });
  test('the STARTING response is not ready', () => {
    expect(
      isDiscoveryReady({ ...full, warnings: [{ code: 'STARTING', message: 'Not yet' }] }),
    ).toBe(false);
  });
  test('Docker unreachable (or anything but ok) is not ready', () => {
    expect(isDiscoveryReady({ ...full, sources: { docker: 'unreachable', manual: 'ok' } })).toBe(
      false,
    );
    expect(isDiscoveryReady({ ...full, sources: { docker: 'whatever', manual: 'ok' } })).toBe(
      false,
    );
  });
  test('other warnings do not matter', () => {
    expect(
      isDiscoveryReady({ ...full, warnings: [{ code: 'CONFIG_INVALID', message: 'x' }] }),
    ).toBe(true);
  });
});

describe('shownGroups', () => {
  test('drops hidden services, and a group left empty', () => {
    const vpn = { ...svc('vpn', 'VPN', 'Infra'), hidden: true as const };
    const groups = [
      group('Media', [svc('plex', 'Plex')]),
      group('Infra', [vpn]),
      group('Mixed', [
        svc('a', 'A', 'Mixed'),
        { ...svc('b', 'B', 'Mixed'), hidden: true as const },
      ]),
    ];
    expect(shownGroups(groups).map((g) => [g.name, g.services.map((s) => s.id)])).toEqual([
      ['Media', ['plex']],
      ['Mixed', ['a']],
    ]);
  });
});
