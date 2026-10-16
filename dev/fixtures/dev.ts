// `yarn dev:fixtures`: the fixture upstreams and `next dev` in one terminal, both stopped by
// Ctrl+C. Run: node --experimental-strip-types dev/fixtures/dev.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const envFile = join(root, 'dev', '.env.fixtures');
const next = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

// Loaded here, not with `node --env-file`: Next re-runs node with NODE_OPTIONS, which refuses it.
process.loadEnvFile(envFile);

const children: ChildProcess[] = [
  spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '--env-file',
      envFile,
      join(root, 'dev', 'fixtures', 'server.ts'),
    ],
    { cwd: root, stdio: 'inherit' },
  ),
  spawn(process.execPath, [next, 'dev', '--hostname', '127.0.0.1', '--port', '3000'], {
    cwd: root,
    stdio: 'inherit',
  }),
];

let stopping = false;
function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  // A child that ignores SIGTERM does not keep the terminal.
  setTimeout(() => process.exit(code), 5000).unref();
}

let alive = children.length;
for (const child of children)
  child.on('exit', (code) => {
    alive -= 1;
    // One child ending ends the other: half a stack is worse than none.
    stop(code ?? 0);
    if (alive === 0) process.exit(code ?? 0);
  });
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
