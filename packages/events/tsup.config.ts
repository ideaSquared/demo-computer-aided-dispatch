import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/auth/index.ts',
    'src/incident/index.ts',
    'src/resource/index.ts',
    'src/presence/index.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
});
