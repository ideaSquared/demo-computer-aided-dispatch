"""Service entrypoint. `python -m triage`."""

from __future__ import annotations

import uvicorn

from triage.app import config


def main() -> None:
    uvicorn.run(
        "triage.app:app",
        host="0.0.0.0",  # noqa: S104 — service runs inside Compose / K8s
        port=config.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
