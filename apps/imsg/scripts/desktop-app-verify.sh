#!/usr/bin/env bash
# Shared verification primitives for staged and activated Comma bundles.

comma_plist_value() {
  plutil -extract "$2" raw -o - "$1/Contents/Info.plist"
}

comma_lock_owner_file_active() {
  local owner="$1" pid identity args
  pid="$(plutil -extract pid raw -o - "$owner" 2>/dev/null || true)"
  identity="$(plutil -extract identity raw -o - "$owner" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [[ "$identity" =~ ^comma:[a-z0-9-]+$ ]] || return 1
  args="$(/bin/ps -p "$pid" -o args= 2>/dev/null || true)"
  case "$args" in
    "$identity"|"$identity "*) return 0 ;;
    *) return 1 ;;
  esac
}

comma_lock_owner_active() {
  comma_lock_owner_file_active "$1/owner.json"
}

comma_acquire_lock() {
  local lock="$1" identity="$2" candidate snapshot attempt
  mkdir -p "$(dirname "$lock")"
  mkdir "$lock" 2>/dev/null || [ -d "$lock" ] || return 1
  candidate="${lock}.owner.$$.$RANDOM.json"
  printf '{"pid":%s,"identity":"%s"}\n' "$$" "$identity" >"$candidate" || return 1

  for attempt in 1 2 3 4 5; do
    if ln "$candidate" "$lock/owner.json" 2>/dev/null; then
      rm -f "$candidate"
      return 0
    fi
    if comma_lock_owner_active "$lock"; then
      rm -f "$candidate"
      return 1
    fi

    snapshot="${lock}.stale.$$.$RANDOM.json"
    if ln "$lock/owner.json" "$snapshot" 2>/dev/null; then
      if ! comma_lock_owner_file_active "$snapshot" \
        && [ "$lock/owner.json" -ef "$snapshot" ]; then
        rm -f "$lock/owner.json"
      fi
      rm -f "$snapshot"
    fi
    sleep 0.05
  done

  rm -f "$candidate"
  return 1
}

comma_acquire_lock_wait() {
  local lock="$1" identity="$2" timeout="$3" elapsed=0
  while ! comma_acquire_lock "$lock" "$identity"; do
    [ "$elapsed" -lt "$timeout" ] || return 1
    sleep 1
    elapsed=$((elapsed + 1))
  done
}

comma_release_lock() {
  local lock="$1" identity="$2" owner_pid owner_identity
  owner_pid="$(plutil -extract pid raw -o - "$lock/owner.json" 2>/dev/null || true)"
  owner_identity="$(plutil -extract identity raw -o - "$lock/owner.json" 2>/dev/null || true)"
  if [ "$owner_pid" = "$$" ] && [ "$owner_identity" = "$identity" ]; then
    rm -f "$lock/owner.json"
    rmdir "$lock" 2>/dev/null || true
  fi
}

comma_running_pids() {
  local binary="$1" line pid command
  if [ -n "${COMMA_PROCESS_PROBE:-}" ]; then
    "$COMMA_PROCESS_PROBE" "$binary"
    return
  fi
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*([0-9]+)[[:space:]]+(.*)$ ]]; then
      pid="${BASH_REMATCH[1]}"
      command="${BASH_REMATCH[2]}"
      case "$command" in
        "$binary"|"$binary "*) printf '%s\n' "$pid" ;;
      esac
    fi
  done < <(/bin/ps -axo pid=,command=)
}

comma_wait_for_exact_process() {
  local binary="$1" timeout="$2" candidate elapsed=0
  while true; do
    candidate="$(comma_running_pids "$binary" 2>/dev/null || true)"
    if [[ "$candidate" =~ ^[0-9]+$ ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    [ "$elapsed" -lt "$timeout" ] || return 1
    sleep 1
    elapsed=$((elapsed + 1))
  done
}

comma_wait_for_no_process() {
  local binary="$1" timeout="$2" elapsed=0
  while [ -n "$(comma_running_pids "$binary" 2>/dev/null || true)" ]; do
    [ "$elapsed" -lt "$timeout" ] || return 1
    sleep 1
    elapsed=$((elapsed + 1))
  done
}

comma_process_stable() {
  local binary="$1" pid="$2" seconds="$3"
  [ "$seconds" -le 0 ] || sleep "$seconds"
  [ "$(comma_running_pids "$binary" 2>/dev/null || true)" = "$pid" ]
}

comma_stop_processes() {
  local binary="$1" timeout="$2" pid
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] && kill "$pid" 2>/dev/null || true
  done < <(comma_running_pids "$binary" 2>/dev/null || true)
  comma_wait_for_no_process "$binary" "$timeout" && return 0
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -9 "$pid" 2>/dev/null || true
  done < <(comma_running_pids "$binary" 2>/dev/null || true)
  comma_wait_for_no_process "$binary" "$timeout"
}

comma_notify() {
  local title="$1" message="$2"
  if [ -n "${COMMA_NOTIFICATION_BIN:-}" ]; then
    "$COMMA_NOTIFICATION_BIN" "$title" "$message" >/dev/null 2>&1 || true
    return
  fi
  /usr/bin/osascript - "$title" "$message" >/dev/null 2>&1 <<'APPLESCRIPT' || true
on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run
APPLESCRIPT
}

comma_verify_app() {
  local app="$1"
  local expected_sha="$2"
  local expected_bundle_id="${3:-com.milad.imsg.desktop}"
  local expected_arch="${4:-arm64}"
  local bundle_id source_sha executable archs signature

  [ -d "$app" ] || { printf 'missing app bundle: %s\n' "$app" >&2; return 1; }
  codesign --verify --deep --strict "$app" || return 1
  signature="$(codesign -dvv "$app" 2>&1)"
  printf '%s\n' "$signature" | /usr/bin/grep -q '^Signature=adhoc$' || {
    printf 'app is not ad-hoc signed: %s\n' "$app" >&2
    return 1
  }

  bundle_id="$(comma_plist_value "$app" CFBundleIdentifier)" || return 1
  [ "$bundle_id" = "$expected_bundle_id" ] || {
    printf 'unexpected bundle ID: %s\n' "$bundle_id" >&2
    return 1
  }
  source_sha="$(comma_plist_value "$app" CommaSourceSHA)" || return 1
  [ "$source_sha" = "$expected_sha" ] || {
    printf 'unexpected shell SHA: %s\n' "$source_sha" >&2
    return 1
  }
  executable="$(comma_plist_value "$app" CFBundleExecutable)" || return 1
  archs="$(lipo -archs "$app/Contents/MacOS/$executable")" || return 1
  case " $archs " in
    *" $expected_arch "*) ;;
    *) printf 'missing expected architecture %s: %s\n' "$expected_arch" "$archs" >&2; return 1 ;;
  esac
}
