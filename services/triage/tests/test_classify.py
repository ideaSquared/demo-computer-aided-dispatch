"""Unit tests for the Ollama-backed classifier. No live Ollama, no gRPC server.

PR 3b assertions: the classifier round-trips a well-formed model response,
returns the UNSPECIFIED sentinel on malformed output, returns UNSPECIFIED on
HTTP error, and short-circuits when both notes and structured fields are
empty.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from triage import classify as classify_module
from triage.classify import PROMPT_VERSION, classify, model_version
from triage.models import TriageRequest, TriageSuggestion


@pytest.fixture
def fire_request() -> TriageRequest:
    return TriageRequest(
        incident_id="i-1",
        notes="Burglary in progress",
        structured_fields={"caller": "999-line", "location": "1 Main St"},
        tier="fire",
    )


# --- helpers ---------------------------------------------------------------


def _ollama_envelope(model_content: dict[str, Any]) -> dict[str, Any]:
    """Build the shape Ollama returns from `/api/chat`: structured output is
    serialised as a JSON string inside `message.content`."""
    return {
        "model": "llama3.2:3b",
        "message": {"role": "assistant", "content": json.dumps(model_content)},
        "done": True,
    }


class _FakeResponse:
    def __init__(self, status_code: int, body: Any):
        self.status_code = status_code
        self._body = body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"status {self.status_code}",
                request=httpx.Request("POST", "http://x"),
                response=httpx.Response(self.status_code),
            )

    def json(self) -> Any:
        return self._body


def _patch_post(monkeypatch: pytest.MonkeyPatch, response: _FakeResponse) -> list[dict[str, Any]]:
    """Patch httpx.post and capture the JSON body sent to Ollama."""
    captured: list[dict[str, Any]] = []

    def fake_post(url: str, *, json: Any, timeout: float) -> _FakeResponse:
        captured.append({"url": url, "json": json, "timeout": timeout})
        return response

    monkeypatch.setattr(classify_module.httpx, "post", fake_post)
    return captured


# --- behaviour -------------------------------------------------------------


def test_round_trips_schema_conforming_model_output(
    monkeypatch: pytest.MonkeyPatch, fire_request: TriageRequest
) -> None:
    captured = _patch_post(
        monkeypatch,
        _FakeResponse(
            200,
            _ollama_envelope(
                {
                    "severity": "high",
                    "confidence": 0.81,
                    "rationale": "active intrusion, occupant hiding",
                }
            ),
        ),
    )

    suggestion = classify(fire_request)
    assert isinstance(suggestion, TriageSuggestion)
    assert suggestion.severity == "high"
    assert suggestion.confidence == pytest.approx(0.81)
    assert suggestion.rationale == "active intrusion, occupant hiding"
    assert suggestion.model_version == model_version()
    assert suggestion.model_version.endswith(f":{PROMPT_VERSION}")

    # The prompt is rendered with the tier so the model can apply tier-specific
    # norms — assert the tier made it into the user message.
    assert len(captured) == 1
    user_msg = captured[0]["json"]["messages"][1]["content"]
    assert "Tier: fire" in user_msg


def test_malformed_model_output_returns_unspecified(
    monkeypatch: pytest.MonkeyPatch, fire_request: TriageRequest
) -> None:
    _patch_post(
        monkeypatch,
        _FakeResponse(
            200,
            # `severity` violates the Literal — the parse must fail.
            _ollama_envelope({"severity": "spicy", "confidence": 0.5, "rationale": "no"}),
        ),
    )

    suggestion = classify(fire_request)
    assert suggestion.severity == "unspecified"
    assert suggestion.confidence == 0.0
    assert suggestion.model_version == model_version()


def test_http_error_returns_unspecified(
    monkeypatch: pytest.MonkeyPatch, fire_request: TriageRequest
) -> None:
    def boom(*_args: Any, **_kwargs: Any) -> _FakeResponse:
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(classify_module.httpx, "post", boom)

    suggestion = classify(fire_request)
    assert suggestion.severity == "unspecified"
    assert suggestion.confidence == 0.0
    assert "model error" in suggestion.rationale


def test_empty_notes_and_no_structured_fields_skip_the_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No httpx call should happen.
    called = False

    def fake_post(*_args: Any, **_kwargs: Any) -> _FakeResponse:
        nonlocal called
        called = True
        raise AssertionError("classify() must skip the model when there's no input")

    monkeypatch.setattr(classify_module.httpx, "post", fake_post)

    suggestion = classify(
        TriageRequest(
            incident_id="i-empty",
            notes="(empty)",
            structured_fields={},
            tier="police",
        )
    )
    assert called is False
    assert suggestion.severity == "unspecified"
    assert "no input" in suggestion.rationale
