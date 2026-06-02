import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'node22',
  splitting: false,
  shims: true,
  // Everything is external; the runtime image carries node_modules + packages
  // so Node's resolution finds @cad/* via pnpm symlinks and @opentelemetry/*
  // via their own dynamic-require-friendly CJS implementations.
});
