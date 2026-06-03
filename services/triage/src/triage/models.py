"""Public domain types — kept in sync with cad.triage.v1.proto (PR 4+)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["low", "medium", "high", "critical"]
# `unspecified` lives on the suggestion (not on the model's output schema):
# it's the "no hint" wire value the Python service emits when classification
# failed or there was no signal to classify on. The LLM itself is constrained
# to the four real bands; UNSPECIFIED never comes back from Ollama.
SuggestionSeverity = Literal["low", "medium", "high", "critical", "unspecified"]
ServiceTier = Literal["police", "medical", "fire"]


class TriageRequest(BaseModel):
    """Incoming intake the operator wants classified."""

    incident_id: str = Field(min_length=1)
    notes: str = Field(min_length=1, max_length=10_000)
    structured_fields: dict[str, str] = Field(default_factory=dict)
    tier: ServiceTier


class TriageSuggestion(BaseModel):
    """The model's best guess. The operator confirms or overrides.

    `severity='unspecified'` is the sentinel for "no hint" — emitted on
    classifier error / empty input. Downstream consumers map it to the
    SEVERITY_UNSPECIFIED proto enum and skip the chip.
    """

    severity: SuggestionSeverity
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str
    model_version: str
