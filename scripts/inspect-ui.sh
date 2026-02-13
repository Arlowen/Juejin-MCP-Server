#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="${MCP_HEALTH_URL:-http://127.0.0.1:3000/health}"
MCP_URL="${MCP_SERVER_URL:-http://127.0.0.1:3000/mcp}"

cd "$ROOT_DIR"

npm run dev &
DEV_PID=$!

cleanup() {
  kill "$DEV_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

for _ in $(seq 1 80); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

npx -y @modelcontextprotocol/inspector --transport http --server-url "$MCP_URL"
