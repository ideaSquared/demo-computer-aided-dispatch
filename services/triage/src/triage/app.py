"""FastAPI app. /health is real; /classify returns a hard-coded stub.

The stub stays until PR 4 wires the Ollama client. Boot-proof is the
contract for PR 3: the service has to come up under docker compose and
respond to /health so `pnpm smoke` is green.
"""

from __future__ import annotations

from fastapi import FastAPI

from triage import __version__
from triage.config import config
from triage.models import TriageRequest, TriageSuggestion

app = FastAPI(
    title="service.triage",
    version=__version__,
    description="AI severity classification via a local LLM (Ollama).",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "service.triage", "version": __version__}


@app.post("/classify", response_model=TriageSuggestion)
def classify(req: TriageRequest) -> TriageSuggestion:
    """Stub — wire the Ollama call in PR 4."""

    return TriageSuggestion(
        severity="medium",
        confidence=0.5,
        rationale=(
            "Stub response. The real classifier is wired in PR 4; until then "
            f"every request returns medium/0.5 against tier={req.tier}."
        ),
        model_version=f"stub@{__version__}",
    )


__all__ = ["app", "config"]
