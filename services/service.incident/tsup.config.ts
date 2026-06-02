import { readdirSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Auto-discover migrations and emit each as its own ESM file under
// `dist/migrations/<name>.js`. node-pg-migrate scans the directory at
// runtime, so each migration must be a standalone entry (no tree-shake
// into the main bundle) AND must live at a path that resolves the same
// way in both build modes:
//
//   - dev (tsx watch):    `migrate.ts` runs from `src/db/migrate.ts`, so
//                         `resolve(HERE, 'migrations') = src/db/migrations/`
//                         (the source layout, which is correct).
//   - prod (node dist):   `migrate.ts` is bundled into `dist/index.js`, so
//                         `resolve(HERE, 'migrations') = dist/migrations/`,
//                         which is why we remap output to `migrations/<n>`
//                         instead of preserving `src/db/migrations/<n>`.
const migrationEntries = Object.fromEntries(
  readdirSync('src/db/migrations')
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [`migrations/${f.replace(/\.ts$/, '')}`, `src/db/migrations/${f}`]),
);

export default defineConfig({
  entry: { index: 'src/index.ts', ...migrationEntries },
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
