"""gRPC server for `cad.triage.v1.TriageService.Classify`.

The Python service ships TWO surfaces in one process: FastAPI on `PORT`
(/health + /classify HTTP for local-dev curl) and gRPC on `GRPC_PORT`
(the cross-service contract every other CAD service consumes). The HTTP
server runs in the main thread (uvicorn); gRPC runs in a background
thread-pool server started before uvicorn from `__main__`.

The generated `cad.triage.v1` Python module is produced at container-build
time (see services/triage/Dockerfile) and is gitignored — same pattern as
`packages/proto/gen/ts/` for TS. The import below resolves once the
Dockerfile codegen step runs.
"""

from __future__ import annotations

import logging
from concurrent import futures

import grpc

# The generated stubs live under `cad/triage/v1/` after `grpc_tools.protoc`
# runs (Dockerfile builder stage). Import them inside a try so `pytest` can
# import this module without codegen having run — `serve()` is the only
# entrypoint that actually touches them.
try:
    from cad.triage.v1 import triage_pb2, triage_pb2_grpc
except ImportError:  # pragma: no cover — covered by the container build.
    triage_pb2 = None  # type: ignore[assignment]
    triage_pb2_grpc = None  # type: ignore[assignment]

from triage.classify import classify as classify_stub
from triage.models import ServiceTier, TriageRequest

log = logging.getLogger("triage.server")


# --- enum mapping (proto ↔ wire strings) -----------------------------------
#
# The proto carries integer enums; the pydantic models carry lowercase
# strings (the same wire form the TS gateway emits). This module is the
# single place that translates between them on the gRPC boundary.

_PROTO_TO_TIER: dict[int, ServiceTier] = {}


def _init_enum_tables() -> None:
    """Populate enum-mapping tables once the generated module is importable."""
    if triage_pb2 is None:
        return
    _PROTO_TO_TIER.clear()
    _PROTO_TO_TIER.update(
        {
            triage_pb2.SERVICE_TIER_POLICE: "police",
            triage_pb2.SERVICE_TIER_MEDICAL: "medical",
            triage_pb2.SERVICE_TIER_FIRE: "fire",
        }
    )


_SEVERITY_TO_PROTO_NAME: dict[str, str] = {
    "low": "SEVERITY_LOW",
    "medium": "SEVERITY_MEDIUM",
    "high": "SEVERITY_HIGH",
    "critical": "SEVERITY_CRITICAL",
}


def _make_servicer():  # noqa: ANN202 — return type is the generated class.
    """Build the gRPC servicer class. Lazy so importing this module pre-codegen
    doesn't blow up — `serve()` calls this after the codegen import succeeds."""
    if triage_pb2 is None or triage_pb2_grpc is None:
        msg = (
            "cad.triage.v1 protobuf bindings not found — run the Dockerfile "
            "builder stage or `pnpm triage:proto-gen` to produce them."
        )
        raise RuntimeError(msg)

    _init_enum_tables()

    class TriageServicer(triage_pb2_grpc.TriageServiceServicer):
        """Stub: hands every request to `classify_stub` and returns the
        canned suggestion. PR 3b swaps in the Ollama-backed classifier."""

        def Classify(  # noqa: N802 — gRPC method names are PascalCase.
            self,
            request,  # noqa: ANN001 — proto-generated type.
            context: grpc.ServicerContext,
        ):  # noqa: ANN202 — proto-generated return type.
            tier_wire = _PROTO_TO_TIER.get(request.tier)
            if tier_wire is None:
                context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    "tier must be one of police, medical, fire",
                )
                raise AssertionError("unreachable: context.abort raises")

            req = TriageRequest(
                incident_id=request.incident_id,
                notes=request.notes or "(empty)",
                structured_fields=dict(request.structured_fields),
                tier=tier_wire,
            )
            suggestion = classify_stub(req)

            severity_name = _SEVERITY_TO_PROTO_NAME[suggestion.severity]
            return triage_pb2.TriageSuggestion(
                severity=getattr(triage_pb2, severity_name),
                confidence=suggestion.confidence,
                rationale=suggestion.rationale,
                model_version=suggestion.model_version,
            )

    return TriageServicer()


def serve(port: int, max_workers: int = 4) -> grpc.Server:
    """Start the gRPC server on `port` and return the running handle.

    Caller owns the lifecycle: keep a reference and call `.stop(grace)` on
    shutdown. The server runs on a thread-pool executor so it doesn't block
    the FastAPI/uvicorn event loop (which lives in the main thread).
    """
    if triage_pb2_grpc is None:
        msg = (
            "cad.triage.v1 protobuf bindings not found — run the Dockerfile "
            "builder stage or `pnpm triage:proto-gen` to produce them."
        )
        raise RuntimeError(msg)

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=max_workers))
    triage_pb2_grpc.add_TriageServiceServicer_to_server(_make_servicer(), server)
    server.add_insecure_port(f"0.0.0.0:{port}")  # noqa: S104 — service runs in Compose / K8s.
    server.start()
    log.info("gRPC TriageService listening on :%d", port)
    return server


__all__ = ["serve"]
