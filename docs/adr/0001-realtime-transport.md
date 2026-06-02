# ADR-0001: Real-time transport for operator clients

- **Status:** Proposed
- **Date:** 2026-06-01
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
- Auth handled per the existing JWT mechanism (`@cad/lib.api`).

## Decision

To be decided after a one-weekend spike. The spike will compare Socket.IO
and native WebSockets on:

- Reconnection ergonomics with the server-authoritative state model.
- Backpressure behaviour under a burst of 500 fan-out messages.
- Compatibility with the Redis pub/sub fan-out pattern in
  `.claude/skills/websocket-fanout`.

SSE is ruled out at the proposal stage because it's unidirectional and
adding a parallel POST channel for acknowledgements adds latency to the
hottest operator action.

## Consequences

(Filled in post-spike.)

## Alternatives considered

- **Socket.IO** — has the room/namespace primitives we want and a battle-
  tested reconnection model, at the cost of a non-standard wire protocol
  and a larger client bundle.
- **Native WebSockets** — smaller bundle and standards-clean, at the cost
  of building reconnection, heartbeating, and room semantics ourselves.
- **Server-Sent Events** — rejected (see Decision).

## References

- [Notion: CAD System — Emergency Services](https://www.notion.so/a5551665a3234a9390a99bd968c021d2)
- [Notion: Engineering Handbook](https://www.notion.so/f3b1c2ee884542ca82d8930561caa25e)
- `.claude/skills/websocket-fanout`
