#!/usr/bin/env bash
# Renders and installs the production Mini server and Expo LaunchAgents.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TARGET_HOME="$HOME"
INSTALL_DIR="$HOME/Library/LaunchAgents"
LOAD=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) REPO_DIR="$2"; shift 2 ;;
    --home) TARGET_HOME="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --no-load) LOAD=0; shift ;;
    *) printf 'launchagents: unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

CANONICAL_REPO="$TARGET_HOME/Programming/Repos/master-db"
[ "$REPO_DIR" = "$CANONICAL_REPO" ] || { printf 'launchagents: production services require canonical repo %s\n' "$CANONICAL_REPO" >&2; exit 1; }
[ -d "$REPO_DIR/apps/imsg" ] || { printf 'launchagents: invalid repo root: %s\n' "$REPO_DIR" >&2; exit 1; }
BACKUP_DIR="${COMMA_LAUNCHAGENT_BACKUP_DIR:-$TARGET_HOME/Library/Application Support/imsg-deploy/launchagents}"
mkdir -p "$INSTALL_DIR" "$BACKUP_DIR"
UID_VALUE="$(id -u)"
CHANGED_LABELS=()

render() {
  local label="$1" template destination temporary backup
  template="$SCRIPT_DIR/launchagents/$label.plist.template"
  destination="$INSTALL_DIR/$label.plist"
  temporary="$destination.tmp.$$"
  backup="$BACKUP_DIR/$label.previous.plist"
  if ! /usr/bin/python3 - "$template" "$temporary" "$REPO_DIR" "$TARGET_HOME" <<'PY'
from pathlib import Path
import sys

template, destination, repo, home = sys.argv[1:]
text = Path(template).read_text(encoding="utf-8")
text = text.replace("__REPO_DIR__", repo).replace("__HOME__", home)
Path(destination).write_text(text, encoding="utf-8")
PY
  then
    rm -f "$temporary"
    return 2
  fi
  if ! plutil -lint "$temporary" >/dev/null; then
    rm -f "$temporary"
    return 2
  fi
  if [ -f "$destination" ] && cmp -s "$temporary" "$destination"; then
    rm "$temporary"
    printf 'LaunchAgent current: %s\n' "$label"
    return 1
  fi
  if [ -f "$destination" ] && ! cp "$destination" "$backup"; then
    rm -f "$temporary"
    return 2
  fi
  if ! mv "$temporary" "$destination"; then
    return 2
  fi
  printf 'Installed LaunchAgent: %s\n' "$destination"
  return 0
}

reload() {
  local label="$1" destination="$INSTALL_DIR/$label.plist" loaded=1
  launchctl bootout "gui/$UID_VALUE/$label" 2>/dev/null || true
  for _ in $(seq 1 20); do
    if ! launchctl print "gui/$UID_VALUE/$label" >/dev/null 2>&1; then loaded=0; break; fi
    sleep 1
  done
  [ "$loaded" -eq 0 ] || { printf 'launchagents: timed out unloading %s\n' "$label" >&2; return 1; }
  for attempt in $(seq 1 5); do
    if launchctl bootstrap "gui/$UID_VALUE" "$destination"; then
      launchctl kickstart -k "gui/$UID_VALUE/$label"
      return 0
    fi
    [ "$attempt" -eq 5 ] || sleep 2
  done
  printf 'launchagents: failed to bootstrap %s\n' "$label" >&2
  return 1
}

verify_identity() {
  local label="$1" identity="$2" pid=""
  for _ in $(seq 1 20); do
    pid="$(launchctl print "gui/$UID_VALUE/$label" 2>/dev/null | /usr/bin/grep -m1 'pid =' | cut -d '=' -f 2 | tr -d ' ;' || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && ps -p "$pid" -o args= | /usr/bin/grep -F "$identity" >/dev/null; then
      printf 'Verified process identity: %s (pid %s)\n' "$identity" "$pid"
      return 0
    fi
    sleep 1
  done
  printf 'launchagents: process identity did not appear: %s\n' "$identity" >&2
  return 1
}

restore_changed() {
  local label backup
  [ "${#CHANGED_LABELS[@]}" -gt 0 ] || return 0
  for label in "${CHANGED_LABELS[@]}"; do
    backup="$BACKUP_DIR/$label.previous.plist"
    [ -f "$backup" ] || continue
    cp "$backup" "$INSTALL_DIR/$label.plist" || continue
    reload "$label" || true
  done
}

for label in com.milad.imsg com.milad.imsg-expo; do
  if render "$label"; then
    CHANGED_LABELS+=("$label")
    changed=1
  else
    result=$?
    [ "$result" -eq 1 ] || { printf 'launchagents: failed to render %s\n' "$label" >&2; restore_changed; exit 1; }
    changed=0
  fi
  if [ "$LOAD" -eq 1 ] && { [ "$changed" -eq 1 ] || ! launchctl print "gui/$UID_VALUE/$label" >/dev/null 2>&1; }; then
    if ! reload "$label"; then
      printf 'launchagents: restoring prior service definitions\n' >&2
      restore_changed
      exit 1
    fi
  fi
done

if [ "$LOAD" -eq 1 ]; then
  if ! verify_identity com.milad.imsg comma:server \
    || ! verify_identity com.milad.imsg-expo comma:expo; then
    restore_changed
    exit 1
  fi
fi
