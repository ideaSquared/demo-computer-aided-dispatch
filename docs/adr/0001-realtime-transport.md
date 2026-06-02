# ADR-0001: Real-time transport for operator clients

- **Status:** Accepted
- **Date:** 2026-06-02
- **Deciders:** @ideaSquared/engineering

## Context

The CAD operator console needs sub-second updates as incidents are opened,
triaged, and dispatched. Multiple operators in different physical locations
watch the same incident concurrently. The Notion CAD page lists three
candidates: Socket.IO, native WebSockets, and Server-Sent Events.

Constraints:

- Bidirectional (operators acknowledge incidents from the same channel they
  receive them on).
- Survives transient network drops (operators on flaky 4G in a vehicle).
- Horizontally scalable across multiple gateway pods.
- Auth handled per the existing JWT mechanism (deferred to Phase 4; Phase 1
  uses a query-param identity stub — see Phase-1 plan).

## Decision

Use **native WebSockets** via `@fastify/websocket` for the operator transport.
Server messages use the discriminated-union shape the gateway PRD specifies
(`{type:'event',topic,payload}`, `{type:'error',code}`); client messages cover
`subscribe`/`unsubscribe`/`command`.

SSE is rejected because it's unidirectional and adding a parallel POST channel
for acknowledgements adds latency to the hottest operator action.

Socket.IO is rejected because its non-standard wire protocol and larger client
bundle don't pay for themselves when the room semantics we actually need
(per-pod topic registry + Redis pub/sub for cross-pod fan-out) are easy to
build directly. The reconnection / heartbeat work we'd have saved is small and
already prescribed by the websocket-fanout skill.

## Consequences

- We own reconnection, heartbeat (ping/pong with a 30 s interval and 2× timeout)
  and topic/room semantics in the gateway. Phase 1 ships an in-memory per-pod
  registry; the PRD's Redis-set membership for multi-pod affinity is deferred.
- Wire format is plain JSON text frames — small, debuggable in browser
  devtools, and the codepath that delivers Redis pub/sub messages re-shapes
  them once at the gateway into `{type:'event',...}` so internal envelope
  shapes don't leak to clients.
- The client library is small: a `useWs` hook over the native `WebSocket`
  global handles connect, exponential-backoff reconnect, subscription resume,
  and typed event dispatch. No npm transport dependency.
- Phase 1 demo vehicle is operator presence/status — legitimately the
  gateway's own Session domain, so no domain service or DB is pulled in to
  prove the spine.

## Alternatives considered

- **Socket.IO** — has the room/namespace primitives we want and a
  battle-tested reconnection model, at the cost of a non-standard wire
  protocol and a larger client bundle. Rejected (see Decision).
- **Server-Sent Events** — unidirectional. Rejected.

## References

- [Notion: CAD System — Emergency Services](https://www.notion.so/a5551665a3234a9390a99bd968c021d2)
- [Notion: PRD — service.gateway](https://www.notion.so/37389ffb19fc81bf84e4f3370ccf8c55)
- [Notion: PRD — service.notification](https://www.notion.so/37389ffb19fc81d98a81c96d715c8f88)
- `.claude/skills/websocket-fanout`
