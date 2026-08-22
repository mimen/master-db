#!/usr/bin/env bash
# Installs Comma's laptop stager and branch-cleanup agents from stable copies.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="${COMMA_DEPLOY_INSTALL_ROOT:-$HOME/Library/Application Support/Comma/Deployment}"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs"
UID_VALUE="$(id -u)"
mkdir -p "$INSTALL_ROOT" "$AGENTS" "$LOGS"

install -m 755 "$SCRIPT_DIR/desktop-autoupdate.sh" "$INSTALL_ROOT/desktop-autoupdate.sh"
install -m 755 "$SCRIPT_DIR/desktop-app-verify.sh" "$INSTALL_ROOT/desktop-app-verify.sh"
install -m 755 "$SCRIPT_DIR/laptop-branch-cleanup.sh" "$INSTALL_ROOT/laptop-branch-cleanup.sh"

STAGER="$AGENTS/com.milad.comma-autoupdate.plist"
CLEANUP="$AGENTS/com.milad.comma-branch-cleanup.plist"
cat >"$STAGER" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.milad.comma-autoupdate</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>-c</string><string>export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"; unset PROCID PROCID_REF PROCID_OFF; exec -a comma:stager /bin/bash "$INSTALL_ROOT/desktop-autoupdate.sh"</string></array>
  <key>StartInterval</key><integer>300</integer><key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/comma-stager.log</string>
  <key>StandardErrorPath</key><string>$LOGS/comma-stager.log</string>
</dict></plist>
PLIST
cat >"$CLEANUP" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.milad.comma-branch-cleanup</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>-c</string><string>unset PROCID PROCID_REF PROCID_OFF; exec -a comma:cleanup /bin/bash "$INSTALL_ROOT/laptop-branch-cleanup.sh"</string></array>
  <key>StartInterval</key><integer>21600</integer><key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/comma-branch-cleanup.log</string>
  <key>StandardErrorPath</key><string>$LOGS/comma-branch-cleanup.log</string>
</dict></plist>
PLIST
plutil -lint "$STAGER" "$CLEANUP" >/dev/null
for label in com.milad.comma-autoupdate com.milad.comma-branch-cleanup; do
  launchctl bootout "gui/$UID_VALUE/$label" 2>/dev/null || true
done
launchctl bootstrap "gui/$UID_VALUE" "$STAGER"
launchctl bootstrap "gui/$UID_VALUE" "$CLEANUP"
launchctl kickstart -k "gui/$UID_VALUE/com.milad.comma-autoupdate"
launchctl kickstart -k "gui/$UID_VALUE/com.milad.comma-branch-cleanup"
printf 'Installed Comma laptop deployment agents from %s\n' "$INSTALL_ROOT"
