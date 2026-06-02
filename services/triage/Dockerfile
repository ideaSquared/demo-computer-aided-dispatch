# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

FROM base AS deps
COPY services/triage/pyproject.toml ./
RUN pip install --upgrade pip && pip install .

FROM deps AS runtime
COPY services/triage/src ./src
ENV PYTHONPATH=/app/src
EXPOSE 5080
CMD ["python", "-m", "triage"]
