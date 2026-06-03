"""Strict environment loading. The ONLY place os.environ is read.

PR 3a introduced `GRPC_PORT` and the `OLLAMA_*` envs. PR 3b adds `NATS_URL`
for the `incident.opened` → `triage.classified` subscriber loop.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    port: int
    grpc_port: int
    ollama_url: str
    ollama_model: str
    nats_url: str
    otel_endpoint: str | None

    @classmethod
    def from_env(cls) -> Config:
        return cls(
            port=int(os.environ.get("PORT", "5080")),
            grpc_port=int(os.environ.get("GRPC_PORT", "5081")),
            ollama_url=os.environ.get("OLLAMA_URL", "http://ollama:11434"),
            ollama_model=os.environ.get("OLLAMA_MODEL", "llama3.2:3b"),
            nats_url=os.environ.get("NATS_URL", "nats://nats:4222"),
            otel_endpoint=os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
        )


config = Config.from_env()
