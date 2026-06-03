"""Ollama-backed severity classifier.

PR 3b replaces PR 3a's hard-coded stub. We call Ollama's `/api/chat` with a
JSON-mode `format` parameter derived from a Pydantic model so the daemon
constrains the model's output to a schema; we then parse the response
through `ClassifyOutput.model_validate_json` so a malformed string raises
rather than silently returning gibberish.

Resilience contract — IMPORTANT: `classify()` must NEVER raise. The
NATS-driven subscriber treats any return value as a real suggestion (or, in
the case of `severity='unspecified'`, a "no hint" signal). Letting an
exception propagate would crash the subscribe handler and break the drain on
the live `incident.opened` subscription. On HTTP error, parse failure, or
timeout we log structurally and return the UNSPECIFIED suggestion.

`model_version` becomes `f"{OLLAMA_MODEL}:{PROMPT_VERSION}"` so the audit
log records BOTH the LLM weights and the prompt template that produced the
suggestion. Bump `PROMPT_VERSION` by hand whenever `prompts/classify.txt`
changes.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from triage.config import config
from triage.models import TriageRequest, TriageSuggestion

log = logging.getLogger("triage.classify")

# Bump this when prompts/classify.txt changes. Audit consumers use the
# combined `model:prompt` token to reproduce a given classification.
PROMPT_VERSION = "v1"


def model_version() -> str:
    """Combined model-and-prompt token. Recomputed per call so tests can patch
    `config.ollama_model` without re-importing the module."""
    return f"{config.ollama_model}:{PROMPT_VERSION}"


# Retained for the PR 3a unit tests that import the symbol; PR 3b's behaviour
# tests assert the new prefixed shape via `model_version()` directly.
STUB_MODEL_VERSION = f"{config.ollama_model}:{PROMPT_VERSION}"

# How long we'll wait on Ollama before giving up. 60s is generous — llama3.2:3b
# on a CPU-only CI runner first token can take ~10s; structured-output
# generation can add a few more. The smoke gives 60s end-to-end.
_OLLAMA_TIMEOUT_S = 60.0

_PROMPT_PATH = Path(__file__).parent / "prompts" / "classify.txt"
_PROMPT_TEMPLATE = _PROMPT_PATH.read_text(encoding="utf-8")


class ClassifyOutput(BaseModel):
    """The shape Ollama is constrained to emit. Lowercase wire severities,
    matching the rest of the codebase (the proto enum lives upstream)."""

    severity: Literal["low", "medium", "high", "critical"]
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(max_length=200)


def _unspecified_suggestion(reason: str) -> TriageSuggestion:
    """The fall-through return — UNSPECIFIED severity with a debug rationale.
    The downstream consumer treats `unspecified` as "no hint", same as if
    the classifier were offline."""
    return TriageSuggestion(
        severity="unspecified",
        confidence=0.0,
        rationale=f"(model error: {reason})"[:200],
        model_version=model_version(),
    )


def _build_prompt(req: TriageRequest) -> str:
    """Render the prompt template. Empty structured_fields renders as `{}` so
    the model sees a stable shape regardless of intake completeness."""
    return _PROMPT_TEMPLATE.format(
        tier=req.tier,
        notes=req.notes,
        structured_fields=json.dumps(req.structured_fields, sort_keys=True),
    )


def classify(req: TriageRequest) -> TriageSuggestion:
    """Classify an incident's severity via Ollama. Never raises — see module
    docstring for the resilience contract."""

    # Both empty? No signal to classify on. Skip the Ollama round trip and
    # return the UNSPECIFIED suggestion directly — same wire shape the model
    # would emit if it had failed, but without burning a call.
    notes_empty = not req.notes or req.notes.strip() in {"", "(empty)"}
    if notes_empty and not req.structured_fields:
        log.info("skipping classify: no notes or structured fields")
        return _unspecified_suggestion("no input")

    prompt = _build_prompt(req)
    body = {
        "model": config.ollama_model,
        "stream": False,
        "format": ClassifyOutput.model_json_schema(),
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a UK emergency-services triage assistant. "
                    "Reply ONLY with JSON matching the schema. Do not explain."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }

    try:
        # Sync httpx — the gRPC server runs handlers on a thread-pool, and
        # the NATS subscriber drives this on a worker thread off the asyncio
        # loop (see subscribers.py). Keeping classify() synchronous matches
        # the existing test pattern.
        resp = httpx.post(
            f"{config.ollama_url}/api/chat",
            json=body,
            timeout=_OLLAMA_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as err:
        log.error("ollama http error: %s", err)
        return _unspecified_suggestion("http error")
    except ValueError as err:
        log.error("ollama returned non-JSON envelope: %s", err)
        return _unspecified_suggestion("non-JSON envelope")

    # Ollama embeds the model's structured output as a JSON string in
    # `message.content`. Anything else means the daemon didn't honor the
    # `format` parameter — treat as a model error.
    content: object = None
    message = data.get("message") if isinstance(data, dict) else None
    if isinstance(message, dict):
        content = message.get("content")
    if not isinstance(content, str) or not content:
        log.error("ollama response missing message.content: %r", data)
        return _unspecified_suggestion("empty content")

    try:
        parsed = ClassifyOutput.model_validate_json(content)
    except ValidationError as err:
        log.error("ollama returned schema-violating content: %s (raw=%r)", err, content)
        return _unspecified_suggestion("schema violation")

    return TriageSuggestion(
        severity=parsed.severity,
        confidence=parsed.confidence,
        rationale=parsed.rationale,
        model_version=model_version(),
    )


__all__ = ["ClassifyOutput", "PROMPT_VERSION", "STUB_MODEL_VERSION", "classify", "model_version"]
