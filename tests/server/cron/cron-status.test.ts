import { readFileSync } from 'node:fs';
import { fetchCronStatus } from '@/lib/server/cron/cron-status';
import { httpRequest } from '@/lib/server/http';

vi.mock('@/lib/server/http', () => ({ httpRequest: vi.fn() }));

const fixture = readFileSync(new URL('../../fixtures/cron/cron-status.json', import.meta.url));
const URL_ = 'http://cron-status.example.invalid:9876/cron-status';

function reply(body: unknown, status = 200) {
  vi.mocked(httpRequest).mockResolvedValue({
    status,
    headers: {},
    body: Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    url: URL_,
    redirects: 0,
  });
}

beforeEach(() => {
  vi.mocked(httpRequest).mockReset();
});

describe('fetchCronStatus', () => {
  test('makes one GET with a 3 s timeout and a size cap', async () => {
    reply(fixture);
    await fetchCronStatus(URL_);
    expect(httpRequest).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(httpRequest).mock.calls[0]![0];
    expect(opts.url).toBe(URL_);
    expect(opts.timeoutMs).toBe(3000);
    expect(opts.maxBytes).toBeGreaterThan(0);
    expect(opts.method ?? 'GET').toBe('GET');
  });

  test('returns name, status, last run, message and url, and drops details and dot', async () => {
    reply(fixture);
    const jobs = await fetchCronStatus(URL_);
    expect(jobs.map((j) => j.name)).toEqual([
      'feed-sync',
      'price-watch',
      'photo-index',
      'report-digest',
      'cert-check',
    ]);
    expect(jobs[0]).toEqual({
      name: 'feed-sync',
      status: 'success',
      lastRun: new Date('2026-10-16T11:45:03.000Z'),
      message: 'Nothing to do.',
      url: 'https://feed-sync.example.invalid/',
    });
    expect(jobs[1]?.url).toBeNull();
    for (const job of jobs)
      expect(Object.keys(job).sort()).toEqual(['lastRun', 'message', 'name', 'status', 'url']);
  });

  test('tolerates a missing message, a null or bad lastRun and an unknown status word', async () => {
    reply({
      jobs: [
        { name: 'a', status: 'success' },
        { name: 'b', status: 'success', lastRun: null, message: null },
        { name: 'c', status: 'success', lastRun: 'yesterday-ish' },
        { name: 'd', status: 'sleeping', lastRun: '2026-10-16T11:00:00Z' },
      ],
    });
    const jobs = await fetchCronStatus(URL_);
    expect(jobs.map((j) => [j.status, j.lastRun, j.message])).toEqual([
      ['success', null, null],
      ['success', null, null],
      ['success', null, null],
      ['unknown', new Date('2026-10-16T11:00:00Z'), null],
    ]);
  });

  test('also accepts a bare list of jobs', async () => {
    reply([{ name: 'a', status: 'failed' }]);
    const jobs = await fetchCronStatus(URL_);
    expect(jobs.map((j) => [j.name, j.status])).toEqual([['a', 'failed']]);
  });

  test.each([
    ['a non-200 answer', () => reply('{"jobs":[]}', 503)],
    ['text that is not JSON', () => reply('<html>')],
    ['an object without a jobs list', () => reply({ items: [] })],
    ['a job without a name', () => reply({ jobs: [{ status: 'success' }] })],
  ])('rejects %s', async (_name, arrange) => {
    arrange();
    await expect(fetchCronStatus(URL_)).rejects.toThrow();
  });

  test('passes a transport failure on', async () => {
    vi.mocked(httpRequest).mockRejectedValue(new Error('socket hang up'));
    await expect(fetchCronStatus(URL_)).rejects.toThrow('socket hang up');
  });
});
