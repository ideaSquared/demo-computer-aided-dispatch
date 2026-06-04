import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// Same proxy posture as app.console: always proxy, swap the target host
// based on whether we're inside Docker. See .claude/skills/new-app and
// .claude/skills/api-fetch for why a hardcoded VITE_API_BASE_URL is wrong.
const isDocker = process.env.DOCKER_ENV === 'true' || process.env.NODE_ENV === 'production';
const gatewayHost = isDocker ? 'service-gateway' : 'localhost';

export default defineConfig(({ mode }) => {
  // In dev, point each `@cad/*` lib at its source so HMR works without a
  // rebuild step. Add an alias here for every workspace lib the responder
  // app imports — missing aliases are the "common mistake" called out in
  // the root CLAUDE.md.
  const libraryAliases =
    mode === 'development'
      ? {
          '@cad/lib.ui': resolve(repoRoot, 'packages/ui/src'),
          '@cad/events/presence': resolve(repoRoot, 'packages/events/src/presence/index.ts'),
          '@cad/events': resolve(repoRoot, 'packages/events/src/index.ts'),
        }
      : {};

  return {
    plugins: [react(), vanillaExtractPlugin()],
    resolve: {
      alias: libraryAliases,
    },
    server: {
      port: 3001,
      host: isDocker ? '0.0.0.0' : 'localhost',
      proxy: {
        '/api': {
          target: `http://${gatewayHost}:5000`,
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: `ws://${gatewayHost}:5000`,
          ws: true,
          changeOrigin: true,
        },
        '/health': {
          target: `http://${gatewayHost}:5000`,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
