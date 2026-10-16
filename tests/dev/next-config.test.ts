import { expect, test } from 'vitest';
import nextConfig from '../../next.config';

test('next dev does not write AGENTS.md or CLAUDE.md into the repo', () => {
  expect((nextConfig as { agentRules?: unknown }).agentRules).toBe(false);
});

test('the dev indicator badge is off', () => {
  expect((nextConfig as { devIndicators?: unknown }).devIndicators).toBe(false);
});
