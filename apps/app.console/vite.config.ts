import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// Docker mode flips the proxy target to the in-network gateway hostname.
// Inside Docker, requests still go through the Vite proxy — never bypass it
// or CSRF breaks. See .claude/skills/new-app and .claude/skills/api-fetch.
const isDocker = process.env.DOCKER_ENV === 'true' || process.env.NODE_ENV === 'production';
const gatewayHost = isDocker ? 'service-gateway' : 'localhost';

export default defineConfig(({ mode }) => {
  const libraryAliases =
    mode === 'development'
      ? {
          '@cad/lib.ui': resolve(repoRoot, 'packages/ui/src'),
          '@cad/lib.authz': resolve(repoRoot, 'packages/lib.authz/src/index.ts'),
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
      port: 3000,
      // In Docker we need to listen on 0.0.0.0 so the host's :3000 port
      // mapping reaches the container; locally `localhost` is correct.
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
