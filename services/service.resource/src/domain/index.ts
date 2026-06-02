/**
 * The Unit aggregate — a pure, I/O-free event-sourced core.
 *
 * `apply`/`fold` derive state from events; the command functions validate
 * transitions and emit events. The repository, gRPC adapter, and NATS
 * publisher that drive this core live in the wiring layer so the domain
 * stays unit-testable without Postgres, gRPC, or NATS.
 *
 * See `.claude/skills/event-sourcing`.
 */
export * from './commands.js';
export * from './errors.js';
export * from './events.js';
export * from './state.js';
