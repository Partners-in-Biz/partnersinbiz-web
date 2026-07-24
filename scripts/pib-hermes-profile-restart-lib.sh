#!/usr/bin/env bash
# Shared Hermes profile restart helpers for skill sync + deferred sweep.
# Source from root-owned installers. Never force-restart a busy profile.
set -euo pipefail

PIB_HERMES_PENDING_DIR="${PIB_HERMES_PENDING_DIR:-/var/lib/partnersinbiz/hermes-restart-pending}"

pib_hermes_profile_port() {
  local profile="$1" env_file port
  env_file="/etc/hermes/profiles/${profile}.env"
  [[ -f "$env_file" ]] || return 1
  port=$(awk -F= '/^API_SERVER_PORT=/{gsub(/"/,"",$2); print $2; exit}' "$env_file")
  [[ "$port" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$port"
}

pib_hermes_profile_api_key() {
  local profile="$1" env_file
  env_file="/etc/hermes/profiles/${profile}.env"
  [[ -f "$env_file" ]] || return 1
  awk -F= '/^API_SERVER_KEY=/{gsub(/^"|"$/,"",$2); print $2; exit}' "$env_file"
}

pib_hermes_established_count() {
  local port="$1"
  # Active /v1/runs hold SSE connections against the API port.
  ss -tn state established "( sport = :${port} )" 2>/dev/null \
    | awk 'NR>1 {c++} END {print c+0}'
}

# Returns 0 when quiet, 1 when still busy after soft wait.
# max_wait=0 means a single instantaneous check (no sleeping wait).
pib_hermes_wait_for_quiet_port() {
  local profile="$1" quiet_needed="${2:-3}" max_wait="${3:-120}"
  local port quiet_streak=0 count started now
  port=$(pib_hermes_profile_port "$profile") || {
    echo "drain skip for ${profile}: no API_SERVER_PORT" >&2
    return 0
  }
  if (( max_wait == 0 )); then
    count=$(pib_hermes_established_count "$port")
    if (( count == 0 )); then
      echo "drain quiet hermes@${profile} port ${port}"
      return 0
    fi
    echo "drain busy hermes@${profile} (${count} established)" >&2
    return 1
  fi
  started=$(date +%s)
  while true; do
    count=$(pib_hermes_established_count "$port")
    if (( count == 0 )); then
      quiet_streak=$((quiet_streak + 1))
      if (( quiet_streak >= quiet_needed )); then
        echo "drain quiet hermes@${profile} port ${port}"
        return 0
      fi
    else
      quiet_streak=0
    fi
    now=$(date +%s)
    if (( now - started >= max_wait )); then
      echo "drain busy hermes@${profile} after ${max_wait}s (${count} established)" >&2
      return 1
    fi
    sleep 1
  done
}

pib_hermes_wait_for_health() {
  local profile="$1" max_wait="${2:-45}"
  local port key started now code
  port=$(pib_hermes_profile_port "$profile") || return 0
  key=$(pib_hermes_profile_api_key "$profile") || return 0
  started=$(date +%s)
  while true; do
    now=$(date +%s)
    if (( now - started >= max_wait )); then
      echo "health timeout for hermes@${profile} after ${max_wait}s" >&2
      return 1
    fi
    code=$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer ${key}" \
      "http://127.0.0.1:${port}/v1/health" || true)
    if [[ "$code" == "200" ]]; then
      echo "health ok hermes@${profile}"
      return 0
    fi
    sleep 1
  done
}

pib_hermes_mark_pending_restart() {
  local profile="$1" reason="${2:-busy}"
  install -d -m 0700 "$PIB_HERMES_PENDING_DIR"
  printf 'profile=%s\nreason=%s\nmarked_at=%s\n' \
    "$profile" "$reason" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    >"${PIB_HERMES_PENDING_DIR}/${profile}"
  chmod 0600 "${PIB_HERMES_PENDING_DIR}/${profile}"
  echo "deferred restart hermes@${profile} (${reason})"
}

pib_hermes_clear_pending_restart() {
  local profile="$1"
  rm -f "${PIB_HERMES_PENDING_DIR}/${profile}"
}

# Restart one profile only when quiet. Returns:
#   0 restarted
#   2 deferred (still busy)
#   1 hard failure
pib_hermes_restart_profile_when_idle() {
  local profile="$1"
  local quiet_needed="${2:-3}"
  local soft_wait="${3:-120}"
  local health_seconds="${4:-45}"
  local gap_seconds="${5:-2}"
  local unit="hermes@${profile}.service"
  local baseline current

  if ! systemctl is-active --quiet "$unit"; then
    echo "skip ${unit}: not active"
    pib_hermes_clear_pending_restart "$profile"
    return 0
  fi

  if ! pib_hermes_wait_for_quiet_port "$profile" "$quiet_needed" "$soft_wait"; then
    pib_hermes_mark_pending_restart "$profile" "busy-after-${soft_wait}s"
    return 2
  fi

  baseline=$(systemctl show "$unit" --property=NRestarts --value)
  systemctl restart "$unit"
  systemctl is-active "$unit"
  if ! pib_hermes_wait_for_health "$profile" "$health_seconds"; then
    pib_hermes_mark_pending_restart "$profile" "health-timeout"
    return 1
  fi
  # Brief crash-loop detection for this unit only.
  sleep 5
  current=$(systemctl show "$unit" --property=NRestarts --value)
  if (( current > baseline )); then
    echo "${unit} crash-looped during restart window" >&2
    pib_hermes_mark_pending_restart "$profile" "crash-loop"
    return 1
  fi
  pib_hermes_clear_pending_restart "$profile"
  if (( gap_seconds > 0 )); then
    sleep "$gap_seconds"
  fi
  echo "restarted hermes@${profile}"
  return 0
}
