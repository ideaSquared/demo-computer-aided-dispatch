"""Service entrypoint. `python -m triage`.

Starts the gRPC `TriageService` (PR 3a) on `GRPC_PORT` in a background
thread, then hands the main thread to uvicorn for the FastAPI `/health`
+ `/classify` surface on `PORT`. Either crash kills the process — the
container restarts (compose `restart: unless-stopped`).
"""

from __future__ import annotations

import logging
import signal
import sys
from types import FrameType

import uvicorn

from triage.app import config
from triage.server import serve as serve_grpc

log = logging.getLogger("triage")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    grpc_server = serve_grpc(config.grpc_port)

    def _shutdown(signum: int, _frame: FrameType | None) -> None:
        log.info("received signal %d, stopping gRPC server", signum)
        grpc_server.stop(grace=2).wait()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    try:
        uvicorn.run(
            "triage.app:app",
            host="0.0.0.0",  # noqa: S104 — service runs inside Compose / K8s.
            port=config.port,
            log_level="info",
        )
    finally:
        # uvicorn returns on its own shutdown path (or an exception); make
        # sure the gRPC server doesn't leak its thread-pool either way.
        grpc_server.stop(grace=2).wait()


if __name__ == "__main__":
    main()
