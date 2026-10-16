import { GET, dynamic, runtime } from '@/app/api/healthz/route';

test('healthz returns ok', async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(runtime).toBe('nodejs');
  expect(dynamic).toBe('force-dynamic');
});
