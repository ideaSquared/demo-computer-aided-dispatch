# syntax=docker/dockerfile:1.7
#
# Multi-stage Python build with cross-language proto codegen baked into
# the image. The Node workspace doesn't pull pip deps; the protoc invocation
# lives inside this Dockerfile so the polyglot seam stays hermetic.
#
#   builder  → install grpcio-tools, run protoc → cad/triage/v1/*.py
#   deps     → install runtime deps via pip
#   runtime  → copy in deps + generated cad/ + src/, run as non-root
#
# The generated `cad/` package is gitignored (services/triage/cad/) — it's
# regenerated on every build, same pattern as packages/proto/gen/ts/ for TS.

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

# --- builder: generate the gRPC bindings from packages/proto -----------------

FROM base AS builder
RUN pip install --upgrade pip && pip install "grpcio-tools>=1.68.0"
# The proto root is staged at /tmp/proto so import paths (`cad.triage.v1`)
# resolve. Output to /app/cad/triage/v1/ matching the runtime layout.
COPY packages/proto/cad /tmp/proto/cad
RUN mkdir -p /app/cad && \
    python -m grpc_tools.protoc \
      -I/tmp/proto \
      --python_out=/app \
      --grpc_python_out=/app \
      /tmp/proto/cad/triage/v1/triage.proto && \
    # protoc emits intermediate packages without __init__.py; create empty
    # ones so `from cad.triage.v1 import triage_pb2` resolves at runtime.
    find /app/cad -type d -exec touch {}/__init__.py \;

# --- deps: install runtime Python deps --------------------------------------

FROM base AS deps
COPY services/triage/pyproject.toml ./
RUN pip install --upgrade pip && pip install .

# --- runtime: copy in deps + generated stubs + source ------------------------

FROM deps AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --shell /bin/bash app
COPY --from=builder /app/cad ./cad
COPY services/triage/src ./src
RUN chown -R app:app /app
USER app
ENV PYTHONPATH=/app/src:/app
EXPOSE 5080 5081
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "triage"]
