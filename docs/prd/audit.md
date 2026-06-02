# PRD — service.audit

**Notion is canonical.** This file is a navigation stub.

The full PRD lives at the Notion page below. To edit it, use the Notion MCP
tools (`notion-fetch`, `notion-update-page`) from a Claude Code session, or
edit in Notion directly. **Do not duplicate the PRD content here.**

- **Notion PRD:** https://www.notion.so/37389ffb19fc81c38503e414e43fc546
- **Owner:** @ideaSquared/engineering
- **Status:** Drafting

## One-liner

Append-only audit log. Pure consumer of `audit.actionTaken` events. Owns
the immutable record of every state transition and access decision.
