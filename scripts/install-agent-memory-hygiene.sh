#!/usr/bin/env bash
# Install PiB-managed Hermes agent-memory hygiene on this host.
# Fleet-only (Mac mini / hermes-vps). Not part of the public customer runtime download.
#
# Usage:
#   ./scripts/install-agent-memory-hygiene.sh              # Mac (LaunchAgent weekly)
#   ./scripts/install-agent-memory-hygiene.sh --vps         # Linux VPS (systemd weekly)
#   ./scripts/install-agent-memory-hygiene.sh --dry-run     # print plan only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_PY="$SCRIPT_DIR/agent-memory-hygiene.py"
MODE="mac"
DRY=0
DAYS="${PIB_MEMORY_HYGIENE_DAYS:-30}"

for arg in "$@"; do
  case "$arg" in
    --vps) MODE="vps" ;;
    --mac) MODE="mac" ;;
    --dry-run) DRY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$SRC_PY" ]]; then
  echo "Missing $SRC_PY" >&2
  exit 1
fi

run() {
  if [[ "$DRY" -eq 1 ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}

install_mac() {
  local hermes_home="${HERMES_HOME:-$HOME/.hermes}"
  local dest_py="$hermes_home/scripts/agent-memory-hygiene.py"
  local log_dir="$hermes_home/logs"
  local plist_dir="$HOME/Library/LaunchAgents"
  local label="com.partnersinbiz.agent-memory-hygiene"
  local plist="$plist_dir/${label}.plist"
  local wrapper="$hermes_home/scripts/agent-memory-hygiene-weekly.sh"

  echo "Installing Mac hygiene → HERMES_HOME=$hermes_home (days=$DAYS)"
  run mkdir -p "$hermes_home/scripts" "$log_dir"
  run cp "$SRC_PY" "$dest_py"
  run chmod 755 "$dest_py"

  if [[ "$DRY" -eq 1 ]]; then
    echo "DRY: write $wrapper"
    echo "DRY: write $plist"
    return 0
  fi

  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HERMES_HOME="${hermes_home}"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:\$PATH"
LOG="${log_dir}/agent-memory-hygiene.log"
mkdir -p "${log_dir}"
{
  echo "==== \$(date -u +%Y-%m-%dT%H:%M:%SZ) weekly agent-memory-hygiene ===="
  /usr/bin/python3 "${dest_py}" --hermes-home "${hermes_home}" --days ${DAYS} --apply
} >>"\$LOG" 2>&1
EOF
  chmod 755 "$wrapper"

  mkdir -p "$plist_dir"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${wrapper}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>0</integer>
    <key>Hour</key>
    <integer>4</integer>
    <key>Minute</key>
    <integer>15</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${log_dir}/agent-memory-hygiene.launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${log_dir}/agent-memory-hygiene.launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>HERMES_HOME</key>
    <string>${hermes_home}</string>
  </dict>
</dict>
</plist>
EOF

  launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "Installed LaunchAgent ${label} (Sunday 04:15 local)"
  echo "Log: ${log_dir}/agent-memory-hygiene.log"
}

install_vps() {
  local hermes_home="${HERMES_HOME:-/var/lib/hermes}"
  local dest_py="$hermes_home/scripts/agent-memory-hygiene.py"
  local unit_dir="${PIB_SYSTEMD_DIR:-/etc/systemd/system}"
  local log="${hermes_home}/logs/agent-memory-hygiene.log"

  if [[ "$(id -u)" -ne 0 ]]; then
    echo "VPS install must run as root" >&2
    exit 1
  fi

  echo "Installing VPS hygiene → HERMES_HOME=$hermes_home (days=$DAYS)"
  run mkdir -p "$hermes_home/scripts" "$hermes_home/logs"
  run cp "$SRC_PY" "$dest_py"
  run chown hermes:hermes "$dest_py"
  run chmod 755 "$dest_py"

  if [[ "$DRY" -eq 1 ]]; then
    echo "DRY: write systemd units to $unit_dir"
    return 0
  fi

  cat > "$unit_dir/hermes-agent-memory-hygiene.service" <<EOF
[Unit]
Description=Weekly Hermes agent-memory dump hygiene (request_dump TTL)
After=network-online.target

[Service]
Type=oneshot
User=hermes
Group=hermes
Environment=HERMES_HOME=${hermes_home}
Environment=PATH=/var/lib/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/python3 ${dest_py} --hermes-home ${hermes_home} --days ${DAYS} --apply
StandardOutput=append:${log}
StandardError=append:${log}
EOF

  cat > "$unit_dir/hermes-agent-memory-hygiene.timer" <<EOF
[Unit]
Description=Weekly Hermes agent-memory hygiene timer

[Timer]
OnCalendar=Sun *-*-* 04:15:00
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now hermes-agent-memory-hygiene.timer
  systemctl status hermes-agent-memory-hygiene.timer --no-pager || true
  echo "Installed systemd timer hermes-agent-memory-hygiene.timer (Sunday ~04:15 UTC+jitter)"
  echo "Log: ${log}"
}

case "$MODE" in
  mac) install_mac ;;
  vps) install_vps ;;
esac
