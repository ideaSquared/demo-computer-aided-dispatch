"""Unit tests for the stub classifier. No Ollama, no gRPC server.

PR 3a's classifier is hard-coded; the load-bearing thing is the contract
shape. PR 3b will add behaviour tests on top of the same module — these
ones pin the stub's return shape so the swap is visible.
"""

from __future__ import annotations

import pytest

from triage.classify import STUB_MODEL_VERSION, classify
from triage.models import TriageRequest, TriageSuggestion


@pytest.fixture
def fire_request() -> TriageRequest:
    return TriageRequest(
        incident_id="i-1",
        notes="Burglary in progress",
        structured_fields={"caller": "999-line", "location": "1 Main St"},
        tier="fire",
    )


def test_classify_returns_canned_suggestion(fire_request: TriageRequest) -> None:
    suggestion = classify(fire_request)
    assert isinstance(suggestion, TriageSuggestion)
    assert suggestion.severity == "medium"
    assert suggestion.confidence == 0.5
    assert suggestion.rationale == "stub"
    assert suggestion.model_version == STUB_MODEL_VERSION
    assert suggestion.model_version == "stub-0.0.0"


def test_classify_ignores_request_content() -> None:
    """The stub returns the same shape regardless of input. Pinned so the
    real-classifier swap in PR 3b makes this test fail loudly."""
    a = classify(
        TriageRequest(incident_id="i-a", notes="trivial", tier="police"),
    )
    b = classify(
        TriageRequest(
            incident_id="i-b",
            notes="MULTIPLE GUNSHOTS HEARD AT 0300",
            structured_fields={"caller": "999"},
            tier="medical",
        ),
    )
    assert a == b
