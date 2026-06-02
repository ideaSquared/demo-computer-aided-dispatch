/**
 * Generated TS clients land in `../gen/ts/` once `pnpm proto:gen` runs
 * via `buf generate`. PR 3 wires that into CI. Until then this package
 * exists so other workspaces can declare a dependency on it and the
 * lockfile reflects the contract surface.
 */

export const SERVING = 'SERVING' as const;
export const NOT_SERVING = 'NOT_SERVING' as const;
export type ServingStatus = typeof SERVING | typeof NOT_SERVING;
