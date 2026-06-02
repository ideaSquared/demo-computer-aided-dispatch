/**
 * Thrown when a command is issued against an aggregate state that forbids it
 * — e.g. marking a unit on-scene that was never dispatched, or registering one
 * that already exists.
 *
 * This is a pure *domain* invariant violation, deliberately distinct from a
 * persistence/optimistic-concurrency conflict (which the repository raises in
 * the wiring layer). Keeping them separate lets the gRPC adapter map domain
 * invariants to `FAILED_PRECONDITION` and concurrency conflicts to `ABORTED`.
 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}
