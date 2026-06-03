"""Tests for the in-process NATS subscriber.

We exercise the pure core, `apply_incident_opened`, without standing up a
real NATS server. That's the same shape as the resource service's
`subscribeIncidents` tests over in TS land.
"""

from __future__ import annotations

from typing import Any

from triage.classify import PROMPT_VERSION
from triage.models import TriageRequest, TriageSuggestion
from triage.subscribers import apply_incident_opened


def _make_classify_fn(captured: list[TriageRequest]) -> Any:
    """Return a fake classify() that records its input and returns a fixed
    suggestion. Lets us assert the subscriber wired the payload through
    correctly."""

    def fake(req: TriageRequest) -> TriageSuggestion:
        captured.append(req)
        return TriageSuggestion(
            severity="high",
            confidence=0.78,
            rationale="chest pain, male 60s, conscious",
            model_version=f"llama3.2:3b:{PROMPT_VERSION}",
        )

    return fake


def test_apply_builds_a_well_formed_envelope() -> None:
    captured: list[TriageRequest] = []
    envelope = apply_incident_opened(
        {
            "eventId": "ev-1",
            "occurredAt": "2026-06-03T10:00:00.000Z",
            "idempotencyKey": "incident:abc:v1",
            "incidentId": "11111111-1111-1111-1111-111111111111",
            "tier": "medical",
            "version": 1,
            "title": "Chest pain reported",
            "location": {"lat": 0, "lng": 0},
            "openedBy": "op-1",
        },
        classify_fn=_make_classify_fn(captured),
    )
    assert envelope is not None
    assert envelope["incidentId"] == "11111111-1111-1111-1111-111111111111"
    assert envelope["severity"] == "high"
    assert envelope["confidence"] == 0.78
    assert envelope["rationale"] == "chest pain, male 60s, conscious"
    assert envelope["modelVersion"] == f"llama3.2:3b:{PROMPT_VERSION}"
    # Idempotency is keyed on incident + model_version so a re-delivery yields
    # the same downstream upsert key — but a new prompt version creates a new
    # row, which is the audit-replay story we want.
    assert (
        envelope["idempotencyKey"]
        == f"triage.classified:11111111-1111-1111-1111-111111111111:llama3.2:3b:{PROMPT_VERSION}"
    )
    # And the classifier received a TriageRequest derived from the event.
    assert len(captured) == 1
    assert captured[0].incident_id == "11111111-1111-1111-1111-111111111111"
    assert captured[0].tier == "medical"
    assert "Chest pain" in captured[0].notes


def test_apply_skips_payload_missing_required_fields() -> None:
    captured: list[TriageRequest] = []
    envelope = apply_incident_opened(
        {"eventId": "ev-x", "title": "no tier or incidentId here"},
        classify_fn=_make_classify_fn(captured),
    )
    assert envelope is None
    assert captured == []


def test_apply_rejects_unknown_tier() -> None:
    captured: list[TriageRequest] = []
    envelope = apply_incident_opened(
        {
            "incidentId": "abc",
            "tier": "cyber",  # unknown tier — must skip
            "title": "ransomware on dispatch console",
        },
        classify_fn=_make_classify_fn(captured),
    )
    assert envelope is None
    assert captured == []
