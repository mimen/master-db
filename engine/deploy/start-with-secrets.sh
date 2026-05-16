#!/usr/bin/env bash
# Wrapper that loads agentic-engine secrets from 1Password before exec'ing the
# Bun process. Invoked by the launchd plist (com.milad.agentic-engine.plist).
set -euo pipefail

export AGENTIC_SERVER_TOKEN="$(op read op://Sol/agentic-engine/server_token)"
export CONVEX_URL="$(op read op://Sol/agentic-engine/convex_url)"
export CONVEX_DEPLOY_KEY="$(op read op://Sol/agentic-engine/convex_deploy_key)"
export PORT="${PORT:-8787}"
export LOG_DIR="${LOG_DIR:-$HOME/.agentic-engine/logs}"

# Use $(dirname "$0")/.. to make this portable across paths.
exec bun --cwd "$(dirname "$0")/.." start
