# service.triage (Python exception)

> **One-liner:** AI severity classification via a local LLM (Ollama). The single Python service in the CAD repo — see CLAUDE.md for why.

## Notion PRD

[**PRD — service.triage**](https://www.notion.so/37389ffb19fc818fbde6ca1132710847)

Notion is the source of truth. This README is a navigation aid only.

## Status (PR 3a)

Polyglot bootstrap. The cross-language seam is live: `cad.triage.v1.TriageService.Classify` is generated for both Python (this service) and TypeScript (the gateway client + `@cad/proto`). The classifier itself is a hard-coded stub returning `medium / 0.5 / "stub" / "stub-0.0.0"`. PR 3b swaps that stub for the Ollama-backed call behind the same gRPC surface.

Surfaces in 3a:

- HTTP `:5080` — `/health` and `/classify` (local-dev convenience).
- gRPC `:5081` — `TriageService.Classify` (the cross-service contract).
- Compose ships an `ollama` sidecar (no model pulled yet — 3b adds that).

## Dev (without Docker)

```bash
cd services/triage
uv venv --python python3.12
uv pip install -e ".[dev]"

# Generate the Python gRPC stubs from packages/proto. The Dockerfile does
# this at build time; locally you re-run after a .proto change.
uv run python -m grpc_tools.protoc \
  -I../../packages/proto \
  --python_out=. --grpc_python_out=. \
  ../../packages/proto/cad/triage/v1/triage.proto
find cad -type d -exec touch {}/__init__.py \;

PORT=5080 GRPC_PORT=5081 uv run python -m triage
curl http://localhost:5080/health
```

Or use the convenience script (runs codegen in a throwaway container):

```bash
pnpm triage:proto-gen
```

## Test

```bash
PYTHONPATH=src:. uv run pytest
```

## Build (Docker)

The Dockerfile is multi-stage: `builder` runs the protoc codegen, `deps`
installs the runtime venv, `runtime` copies in everything and drops to a
non-root user.

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
