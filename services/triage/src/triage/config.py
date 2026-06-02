"""Strict environment loading. The ONLY place os.environ is read."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    port: int
    ollama_url: str
    ollama_model: str
    otel_endpoint: str | None

    @classmethod
    def from_env(cls) -> Config:
        return cls(
            port=int(os.environ.get("PORT", "5080")),
            ollama_url=os.environ.get("OLLAMA_URL", "http://ollama:11434"),
            ollama_model=os.environ.get("OLLAMA_MODEL", "llama3.2:3b"),
            otel_endpoint=os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
        )


config = Config.from_env()
