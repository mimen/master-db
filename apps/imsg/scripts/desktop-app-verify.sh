#!/usr/bin/env bash
# Shared verification primitives for staged and activated Comma bundles.

comma_plist_value() {
  plutil -extract "$2" raw -o - "$1/Contents/Info.plist"
}

comma_lock_owner_active() {
  local lock="$1" pid identity args
  pid="$(plutil -extract pid raw -o - "$lock/owner.json" 2>/dev/null || true)"
  identity="$(plutil -extract identity raw -o - "$lock/owner.json" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [[ "$identity" =~ ^comma:[a-z0-9-]+$ ]] || return 1
  args="$(/bin/ps -p "$pid" -o args= 2>/dev/null || true)"
  case "$args" in
    "$identity"|"$identity "*) return 0 ;;
    *) return 1 ;;
  esac
}

comma_acquire_lock() {
  local lock="$1" identity="$2"
  if ! mkdir "$lock" 2>/dev/null; then
    comma_lock_owner_active "$lock" && return 1
    rm -rf "$lock"
    mkdir "$lock" 2>/dev/null || return 1
  fi
  printf '{"pid":%s,"identity":"%s"}\n' "$$" "$identity" >"$lock/owner.json"
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
