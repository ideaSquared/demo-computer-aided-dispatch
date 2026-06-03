"""FastAPI app. /health is real; /classify proxies the stub classifier.

PR 3a's classifier is hard-coded — see `triage.classify`. PR 3b plumbs the
Ollama call into the same function. The HTTP `/classify` route stays for
local-dev convenience; the cross-service contract is gRPC — see
`triage.server.TriageServicer.Classify`.
"""

from __future__ import annotations

from fastapi import FastAPI

from triage import __version__
from triage.classify import classify as classify_stub
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
    """Stub — wire the Ollama call in PR 3b. The cross-service contract is
    `cad.triage.v1.TriageService.Classify` (gRPC); this HTTP route mirrors
    it for local-dev curl/probe convenience."""
    return classify_stub(req)


__all__ = ["app", "config"]
