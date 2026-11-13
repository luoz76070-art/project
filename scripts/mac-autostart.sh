#!/usr/bin/env bash
set -euo pipefail
mode="${1:-status}"
label="local.mobile-codex.relay"
plist="$HOME/Library/LaunchAgents/$label.plist"
case "$mode" in
  install)
    app_path="${2:?Usage: scripts/mac-autostart.sh install '/absolute/path/Mobile Codex Relay.app'}"
    [[ "$app_path" = /* && -x "$app_path/Contents/MacOS/MobileCodexRelay" ]] || { echo "Built Relay app not found"; exit 2; }
    mkdir -p "$(dirname "$plist")"
    python3 - "$plist" "$app_path" "$label" <<'PY'
import os, plistlib, sys
file, app, label = sys.argv[1:]
with open(file, 'wb') as output:
    plistlib.dump({'Label': label, 'ProgramArguments': [app + '/Contents/MacOS/MobileCodexRelay'], 'RunAtLoad': True,
                  'KeepAlive': {'SuccessfulExit': False}, 'ThrottleInterval': 15, 'LimitLoadToSessionType': 'Aqua'}, output)
os.chmod(file, 0o600)
PY
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    rm -f "$plist"
    ;;
  status) launchctl print "gui/$(id -u)/$label" ;;
  *) echo "Usage: scripts/mac-autostart.sh {install <app>|uninstall|status}"; exit 2 ;;
esac
