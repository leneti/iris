import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const emptyModule = fileURLToPath(new URL('./tests/empty-module.ts', import.meta.url));

const shared = {
  plugins: [react(), tsconfigPaths()],
  resolve: { alias: { 'server-only': emptyModule } },
};

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        ...shared,
        test: {
          name: 'dom',
          globals: true,
          setupFiles: ['tests/reset-shared.ts'],
          environment: 'jsdom',
          include: ['tests/components/**/*.test.{ts,tsx}', 'tests/client/**/*.test.{ts,tsx}'],
        },
      },
      {
        ...shared,
        test: {
          name: 'node',
          globals: true,
          setupFiles: ['tests/reset-shared.ts'],
          environment: 'node',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/components/**', 'tests/client/**'],
        },
      },
    ],
  },
});
