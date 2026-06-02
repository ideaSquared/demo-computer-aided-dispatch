# service.triage (Python exception)

> **One-liner:** AI severity classification via a local LLM (Ollama). The single Python service in the CAD repo — see CLAUDE.md for why.

## Notion PRD

[**PRD — service.triage**](https://www.notion.so/37389ffb19fc818fbde6ca1132710847)

Notion is the source of truth. This README is a navigation aid only.

## Status (PR 3)

Stub. `/health` and `/classify` are wired but the classifier returns a hard-coded `medium` / `confidence: 0.5` suggestion. PR 4 plugs the Ollama call in. Boot-proof is the contract for PR 3: the service starts under docker compose and responds to `/health` so `pnpm smoke` is green.

## Dev (without Docker)

```bash
cd services/triage
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
PORT=5080 python -m triage
curl http://localhost:5080/health
```

## Test

```bash
pytest
```

## Build (Docker)

```bash
docker build -t cad/service.triage -f services/triage/Dockerfile .
```

## Why Python here

The Ollama / structured-output / instruction-tuning ecosystem is materially better in Python than Node. This is the single documented exception to the TypeScript mandate (`CLAUDE.md`). All other services are TS.

## Conventions

- Strict types (mypy `strict`).
- Ruff for lint + import sort.
- Env via `triage.config.Config.from_env()` — the only place `os.environ` is read.
- OTel via `opentelemetry-distro`; same Jaeger backend as the TS services so traces stay continuous across the gRPC boundary.
