import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: false,
  shims: true,
  // Bundle every internal workspace package into the service binary so the
  // runtime image only needs node_modules + dist (the package.json refers
  // to workspace:* deps that don't exist at runtime).
  noExternal: [/^@cad\//],
});
