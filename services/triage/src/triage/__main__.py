"""Service entrypoint. `python -m triage`.

Three surfaces run in one process:

  - gRPC `TriageService` on `GRPC_PORT` (thread-pool executor).
  - FastAPI `/health` + `/classify` on `PORT` (main thread, uvicorn).
  - NATS subscriber on `incident.opened` → publish `triage.classified`
    (background thread running its own asyncio loop).

Either crash kills the process — the container restarts
(compose `restart: unless-stopped`).
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys
import threading
from types import FrameType

import uvicorn

from triage.app import config
from triage.server import serve as serve_grpc
from triage.subscribers import serve_in_background_loop

log = logging.getLogger("triage")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    grpc_server = serve_grpc(config.grpc_port)

    # NATS subscriber runs on its own thread with its own asyncio loop. We
    # hold the (loop, task) so shutdown can cancel the task and stop the loop
    # cleanly — `nc.drain()` runs inside `_serve_async`'s `finally`.
    nats_loop: asyncio.AbstractEventLoop | None = None
    nats_task: asyncio.Task[None] | None = None

    def _run_subscriber() -> None:
        nonlocal nats_loop, nats_task
        try:
            nats_loop, nats_task = serve_in_background_loop()
            nats_loop.run_forever()
        except Exception as err:  # noqa: BLE001 — log + crash visibly.
            log.error("subscriber thread crashed: %s", err)

    subscriber_thread = threading.Thread(
        target=_run_subscriber, name="triage-subscriber", daemon=True
    )
    subscriber_thread.start()

    def _shutdown(signum: int, _frame: FrameType | None) -> None:
        log.info("received signal %d, stopping", signum)
        if nats_loop is not None and nats_task is not None:
            # Schedule cancellation + loop stop on the subscriber's own loop.
            def _stop() -> None:
                if nats_task is not None and not nats_task.done():
                    nats_task.cancel()
                if nats_loop is not None:
                    nats_loop.stop()

            nats_loop.call_soon_threadsafe(_stop)
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
