"""Classifier stub.

PR 3a returns a hard-coded `TriageSuggestion` regardless of input — the
load-bearing thing is the cross-language seam (proto → gRPC → Python),
not the model output. PR 3b swaps `classify()` for the real Ollama call
behind the same signature.
"""

from __future__ import annotations

from triage.models import TriageRequest, TriageSuggestion

STUB_MODEL_VERSION = "stub-0.0.0"


def classify(req: TriageRequest) -> TriageSuggestion:
    """Hard-coded stub. Replaced by the Ollama client in PR 3b."""
    _ = req  # the stub ignores its input on purpose.
    return TriageSuggestion(
        severity="medium",
        confidence=0.5,
        rationale="stub",
        model_version=STUB_MODEL_VERSION,
    )
