"""Smoke test for /health and /classify. No Ollama required."""

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


def test_classify_returns_a_suggestion() -> None:
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
    assert body["severity"] in {"low", "medium", "high", "critical"}
    assert 0.0 <= body["confidence"] <= 1.0
