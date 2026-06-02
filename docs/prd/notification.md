# PRD — service.notification

**Notion is canonical.** This file is a navigation stub.

The full PRD lives at the Notion page below. To edit it, use the Notion MCP
tools (`notion-fetch`, `notion-update-page`) from a Claude Code session, or
edit in Notion directly. **Do not duplicate the PRD content here.**

- **Notion PRD:** https://www.notion.so/37389ffb19fc81d98a81c96d715c8f88
- **Owner:** @ideaSquared/engineering
- **Status:** Drafting

## One-liner

WebSocket fan-out spine. Subscribes to NATS domain events and re-publishes
on Redis pub/sub channels per topic so every gateway pod stays in sync.
