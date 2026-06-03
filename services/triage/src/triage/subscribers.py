"""NATS subscriber that drives the AI-suggestion loop.

Listens on `incident.opened`, calls `classify()` with what the event carries,
and publishes a `triage.classified` envelope. Lives in the same process as
the gRPC server: a single asyncio event loop on a background thread, started
from `__main__` before uvicorn takes the main thread.

Why in-process, not a separate Python worker:
  - the @cad/events spine elsewhere is per-service; mirroring that here keeps
    the polyglot story honest (one Python service, two surfaces).
  - the classifier is pure (no shared state with the gRPC handler), so
    running it on the asyncio loop's default executor stays trivially safe.

Idempotency: `idempotencyKey` is set to `triage.classified:<incidentId>:<modelVersion>`
so the incident-side upsert is a clean no-op on re-delivery — same write
twice yields the same row.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from nats.aio.client import Client as NatsClient

from triage.classify import classify, model_version
from triage.config import config
from triage.models import ServiceTier, TriageRequest, TriageSuggestion

log = logging.getLogger("triage.subscribers")

INCIDENT_OPENED_SUBJECT = "incident.opened"
TRIAGE_CLASSIFIED_SUBJECT = "triage.classified"

_TIERS: set[str] = {"police", "medical", "fire"}


def _now() -> str:
    """RFC3339 timestamp in UTC, matching the @cad/events envelope shape."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    )


def apply_incident_opened(
    payload: dict[str, Any],
    classify_fn: Any = classify,
) -> dict[str, Any] | None:
    """Pure-ish core of the subscriber: payload → triage.classified envelope.

    Extracted from the subscribe loop so unit tests can drive it without
    standing up a NATS server. Returns `None` when the payload doesn't carry
    the fields we need to classify (so the loop can skip publishing). The
    classifier is injected so a test can pass a fake.

    `incident.opened` carries `incidentId`, `tier`, and `title`. It does not
    (yet) carry the operator's free-form notes — that's a separate event
    schema change which we deliberately keep out of this PR. Classify with
    `title` as `notes` and the rest as structured fields; if the model is
    weak on the limited signal, the chip just lands with low confidence.
    """
    incident_id = payload.get("incidentId")
    tier = payload.get("tier")
    title = payload.get("title", "")
    if not isinstance(incident_id, str) or tier not in _TIERS:
        log.info(
            "skip classify: payload missing required fields",
            extra={"incidentId": incident_id, "tier": tier},
        )
        return None

    # `incident.opened` doesn't carry notes today (see module docstring); use
    # the title as the model's input and surface the structured aggregate
    # context (tier, openedBy) so the model has something to ground on.
    notes_source = title if isinstance(title, str) else ""
    structured = {
        k: str(v)
        for k, v in payload.items()
        if k in {"openedBy", "tier"} and v is not None
    }

    try:
        req = TriageRequest(
            incident_id=incident_id,
            notes=notes_source or "(empty)",
            structured_fields=structured,
            tier=tier,  # type: ignore[arg-type]  # validated above
        )
    except Exception as err:  # noqa: BLE001 — validation/coercion errors are skips.
        log.error("skip classify: request validation failed: %s", err)
        return None

    suggestion: TriageSuggestion = classify_fn(req)

    # Match @cad/events `TriageClassifiedSchema` exactly — the TS subscriber
    # validates with Zod before touching the DB. Keys are camelCase to match
    # the rest of the wire vocabulary.
    return {
        "eventId": str(uuid.uuid4()),
        "occurredAt": _now(),
        # Re-delivery of the same incident-opened event must produce the same
        # downstream upsert key, so use a stable function of the incident and
        # the model+prompt combo. Different prompt versions create new rows
        # for the same incident — exactly the audit-replay story we want.
        "idempotencyKey": f"triage.classified:{incident_id}:{suggestion.model_version}",
        "incidentId": incident_id,
        "severity": suggestion.severity,
        "confidence": suggestion.confidence,
        "rationale": suggestion.rationale,
        "modelVersion": suggestion.model_version,
    }


async def _run_subscriber(nc: NatsClient) -> None:
    """Subscribe to `incident.opened` and publish `triage.classified`. Stays
    alive for the lifetime of the NATS connection — caller manages shutdown
    via `nc.drain()`."""

    async def handler(msg: Any) -> None:
        try:
            payload = json.loads(msg.data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as err:
            log.error("dropping malformed incident.opened: %s", err)
            return
        if not isinstance(payload, dict):
            log.error("dropping non-object incident.opened payload: %r", payload)
            return

        # Run the (blocking) Ollama call off the event loop so the subscriber
        # keeps draining while the model is generating.
        loop = asyncio.get_running_loop()
        envelope = await loop.run_in_executor(None, apply_incident_opened, payload)
        if envelope is None:
            return

        await nc.publish(
            TRIAGE_CLASSIFIED_SUBJECT,
            json.dumps(envelope).encode("utf-8"),
        )
        log.info(
            "published triage.classified",
            extra={
                "incidentId": envelope["incidentId"],
                "severity": envelope["severity"],
                "modelVersion": envelope["modelVersion"],
            },
        )

    await nc.subscribe(INCIDENT_OPENED_SUBJECT, cb=handler)
    log.info("subscribed to %s", INCIDENT_OPENED_SUBJECT)


async def _serve_async() -> None:
    """Connect to NATS and keep the subscriber running until cancelled."""
    nc = NatsClient()
    await nc.connect(servers=[config.nats_url])
    log.info("connected to NATS at %s", config.nats_url)
    try:
        await _run_subscriber(nc)
        # Keep the loop alive until cancelled (driven by SIGTERM in __main__).
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        log.info("subscriber cancelled — draining")
        raise
    finally:
        try:
            await nc.drain()
        except Exception as err:  # noqa: BLE001 — best-effort cleanup.
            log.warning("nats drain failed: %s", err)


def serve_in_background_loop() -> tuple[asyncio.AbstractEventLoop, asyncio.Task[None]]:
    """Spin up a dedicated asyncio loop on this thread and start the
    subscriber. Caller is responsible for stopping the loop on shutdown
    (cancel the task, then call `loop.stop()`).

    Returns the (loop, task) pair so `__main__` can join and tear down."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    task = loop.create_task(_serve_async())
    return loop, task


# `model_version` re-export so tests can `from triage.subscribers import model_version`
# without a second import path. Cheap convenience.
__all__ = [
    "INCIDENT_OPENED_SUBJECT",
    "TRIAGE_CLASSIFIED_SUBJECT",
    "apply_incident_opened",
    "model_version",
    "serve_in_background_loop",
]
