#!/usr/bin/env bash
# Reports deployed, staged, and activated Comma identity from the real surfaces.
set -euo pipefail

URL="${IMSG_TAILNET_URL:-https://milads-mac-mini.taild31e9a.ts.net:8447}"
APP="${COMMA_APP:-$HOME/Applications/Comma.app}"
STAGED="${COMMA_STAGED_APP:-${APP}.staged}"

json_field() {
  printf '%s' "$1" | plutil -extract "$2" raw -o - -- - 2>/dev/null || true
}

app_field() {
  local app="$1" key="$2"
  [ -d "$app" ] || return 0
  plutil -extract "$key" raw -o - "$app/Contents/Info.plist" 2>/dev/null || true
}

health_json="$(curl -sf --max-time 15 "$URL/api/health" 2>/dev/null || true)"
web_json="$(curl -sf --max-time 15 "$URL/api/deploy/status" 2>/dev/null || true)"
shell_json="$(curl -sf --max-time 15 "$URL/api/desktop-release" 2>/dev/null || true)"

web_sha="$(json_field "$web_json" webSha)"
web_environment="$(json_field "$web_json" environment)"
deployed_shell_sha="$(json_field "$shell_json" sourceSha)"
running_shell_sha="$(app_field "$APP" CommaSourceSHA)"
staged_shell_sha="$(app_field "$STAGED" CommaSourceSHA)"
bundle_id="$(app_field "$APP" CFBundleIdentifier)"

running_count=0
if [ -d "$APP" ]; then
  executable="$(app_field "$APP" CFBundleExecutable)"
  binary="$APP/Contents/MacOS/$executable"
  running_count="$(/usr/bin/pgrep -f "^${binary//./\\.}( |$)" 2>/dev/null | wc -l | tr -d ' ')"
fi

printf 'Production URL: %s\n' "$URL"
printf 'Health: %s\n' "$(json_field "$health_json" ok)"
printf 'Web deployed: %s / %s\n' "${web_environment:-unavailable}" "${web_sha:-unavailable}"
printf 'Shell deployed: %s\n' "${deployed_shell_sha:-unavailable}"
printf 'Shell installed: %s (%s)\n' "${running_shell_sha:-unavailable}" "${bundle_id:-unavailable}"
printf 'Shell staged: %s\n' "${staged_shell_sha:-none}"
printf 'Production processes: %s\n' "$running_count"
