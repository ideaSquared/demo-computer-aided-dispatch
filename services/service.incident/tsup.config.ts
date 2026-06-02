import { defineConfig } from 'tsup';

export default defineConfig({
  // Migration files are entrypoints too: node-pg-migrate `import()`s them
  // at runtime by directory scan, so they must each be their own ESM file
  // in `dist/db/migrations/` rather than getting tree-shaken into index.js.
  entry: ['src/index.ts', 'src/db/migrations/*.ts'],
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
