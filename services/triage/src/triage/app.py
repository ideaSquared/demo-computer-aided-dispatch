"""FastAPI app. /health is real; /classify proxies the real classifier.

PR 3b: `/classify` calls into the Ollama-backed `classify()`. The HTTP route
stays for local-dev curl convenience; the cross-service contract is gRPC —
see `triage.server.TriageServicer.Classify`.
"""

from __future__ import annotations

from fastapi import FastAPI

from triage import __version__
from triage.classify import classify as classify_fn
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
    """Local-dev convenience route. Cross-service contract is the gRPC
    `cad.triage.v1.TriageService.Classify`; this HTTP route just calls into
    the same `classify()` so a `curl` from the host returns the live shape."""
    return classify_fn(req)


__all__ = ["app", "config"]
