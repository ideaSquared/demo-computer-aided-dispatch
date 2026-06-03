"""HTTP-surface tests for FastAPI /health and /classify. No Ollama required.

The cross-service contract is gRPC `TriageService.Classify`; this module
pins the HTTP convenience surface (local-dev curl) and asserts it returns
the same stub shape as the in-process classifier.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from triage.app import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "service.triage"


def test_classify_returns_the_stub_suggestion() -> None:
    resp = client.post(
        "/classify",
        json={
            "incident_id": "i-1",
            "notes": "Burglary in progress",
            "tier": "police",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "severity": "medium",
        "confidence": 0.5,
        "rationale": "stub",
        "model_version": "stub-0.0.0",
    }
