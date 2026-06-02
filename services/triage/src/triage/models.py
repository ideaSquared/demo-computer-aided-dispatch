"""Public domain types — kept in sync with cad.triage.v1.proto (PR 4+)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["low", "medium", "high", "critical"]
ServiceTier = Literal["police", "medical", "fire"]


class TriageRequest(BaseModel):
    """Incoming intake the operator wants classified."""

    incident_id: str = Field(min_length=1)
    notes: str = Field(min_length=1, max_length=10_000)
    structured_fields: dict[str, str] = Field(default_factory=dict)
    tier: ServiceTier


class TriageSuggestion(BaseModel):
    """The model's best guess. The operator confirms or overrides."""

    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str
    model_version: str
