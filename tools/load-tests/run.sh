#!/usr/bin/env bash
# Run a k6 scenario. Prefers the host `k6` binary if available; falls
# back to `docker run grafana/k6:latest` otherwise. Either way the JSON
# summary lands in `load-results/<scenario>-<timestamp>.json` at the
# repo root.
#
# Usage:
#   tools/load-tests/run.sh <scenario-name> [extra k6 args...]
#
# Where <scenario-name> matches a file in tools/load-tests/scenarios/
# without the `.js` suffix.

set -euo pipefail

scenario="${1:-}"
if [[ -z "$scenario" ]]; then
  echo "usage: $0 <scenario-name> [extra k6 args...]" >&2
  echo "scenarios:" >&2
  ls tools/load-tests/scenarios/*.js | xargs -n1 basename | sed 's/\.js$//' | sed 's/^/  /' >&2
  exit 2
fi
shift || true

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
script_path="tools/load-tests/scenarios/${scenario}.js"
if [[ ! -f "${repo_root}/${script_path}" ]]; then
  echo "no such scenario: ${script_path}" >&2
  exit 2
fi

mkdir -p "${repo_root}/load-results"
ts="$(date +%Y%m%d-%H%M%S)"
summary="load-results/${scenario}-${ts}.json"

cd "${repo_root}"
if command -v k6 >/dev/null 2>&1; then
  exec k6 run --summary-export "${summary}" "$@" "${script_path}"
fi

# Fallback: containerised k6. --network host so localhost on the host
# maps to the gateway container's published port.
exec docker run --rm --network host \
  -v "${repo_root}/tools/load-tests:/scripts:ro" \
  -v "${repo_root}/load-results:/results" \
  grafana/k6:latest run \
  --summary-export "/results/$(basename "${summary}")" \
  "$@" \
  "/scripts/scenarios/${scenario}.js"
