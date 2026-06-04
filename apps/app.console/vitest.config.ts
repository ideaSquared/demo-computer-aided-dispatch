import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export default defineConfig({
  plugins: [react(), vanillaExtractPlugin()],
  // Mirror vite.config.ts's dev aliases so workspace `src/index.ts` entries
  // resolve in vitest's node-resolution context — the workspace packages
  // don't ship pre-built `dist/` during normal dev / test.
  resolve: {
    alias: {
      '@cad/lib.ui': resolve(repoRoot, 'packages/ui/src'),
      '@cad/lib.authz': resolve(repoRoot, 'packages/lib.authz/src/index.ts'),
      '@cad/events/presence': resolve(repoRoot, 'packages/events/src/presence/index.ts'),
      '@cad/events': resolve(repoRoot, 'packages/events/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
