#!/bin/zsh
# launchd entry point on the Mac Mini for the saved-items inbox: saved-job.sh x|instagram|triage [args...]
# The plists wrap it in hub/bin/run, which posts each run to the hub. A failure also files a needs-you item
# tied to the job, so it resolves itself on the next green run.
set -uo pipefail

JOB=${1:?usage: saved-job.sh x|instagram|triage [args...]}; shift
REPO="${0:A:h:h}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export OP_LOAD_DESKTOP_APP_SETTINGS=false  # op otherwise probes the 1Password app and can hang
OP=/opt/homebrew/bin/op
BUN=/opt/homebrew/bin/bun

if [ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  TOKEN_LINE=$(/usr/bin/grep -E '^export OP_SERVICE_ACCOUNT_TOKEN=' "$HOME/.zshrc" | head -1)
  [ -n "$TOKEN_LINE" ] && eval "$TOKEN_LINE"
fi

# Every failure past this point files a needs-you item before exiting.
fail() {
  local STATUS=$1
  local SUBJECT="knowledge:saved-items-$JOB"
  local FIX="Read ~/Library/Logs/saved-items/$JOB.log on the Mini, fix the cause, then rerun: launchctl kickstart gui/\$(id -u)/com.milad.saved-items.$JOB"
  [ "$JOB" = instagram ] && [ "$STATUS" -eq 2 ] && \
    FIX="Re-capture the sproutbeats Instagram session (~/.config/sol-sessions/instagram/sproutbeats.json) per the instagram skill's Auth section, then kickstart com.milad.saved-items.instagram"
  print -r -- "The saved-items $JOB job on the Mini exited $STATUS at $(date '+%F %T'). Log: ~/Library/Logs/saved-items/$JOB.log. $FIX" |
    "$HOME/Programming/Repos/hub/bin/needs-you" --subject "$SUBJECT" --summary "saved-items $JOB job failed (exit $STATUS)" \
      --kind access --fix "$FIX" --origin job --job "mini.launchd.com.milad.saved-items.$JOB" >&2 || echo "WARN: needs-you filing failed" >&2
  exit "$STATUS"
}

# Secrets are read here, not from bun: op spawned from bun under launchd hangs.
secret() { "$OP" read "$1" </dev/null 2>/dev/null; }
SAVED_INGEST_SECRET=$(secret "op://Sol/Saved Ingest Secret/credential")
[ -z "$SAVED_INGEST_SECRET" ] && { echo "ERROR: op read Saved Ingest Secret failed" >&2; fail 3; }
export SAVED_INGEST_SECRET

case "$JOB" in
  x)
    for pair in X_API_KEY:api_key X_API_SECRET:api_secret X_ACCESS_TOKEN:access_token X_ACCESS_SECRET:access_secret; do
      value=$(secret "op://Sol/X API sproutbeats/${pair#*:}")
      [ -z "$value" ] && { echo "ERROR: op read X API sproutbeats/${pair#*:} failed" >&2; fail 3; }
      export "${pair%%:*}=$value"
    done
    export X_USER_ID=3238342757  # @sproutbeats; saves a /users/me read per run
    SCRIPT=saved-x.ts ;;
  instagram) SCRIPT=saved-instagram.ts ;;
  triage) SCRIPT=saved-triage.ts ;;
  *) echo "unknown job $JOB" >&2; exit 2 ;;
esac

echo "[$(date '+%F %T')] saved-$JOB starting"
"$BUN" run "$REPO/scripts/$SCRIPT" "$@" </dev/null || fail $?
