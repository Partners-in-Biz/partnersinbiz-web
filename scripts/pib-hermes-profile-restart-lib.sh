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
  # Clients connected TO the API port (dport) carry the peer process name.
  # Active /v1/runs show up here. Ignore pure edge keepalives (caddy, sshd).
  # Do NOT ignore pib-runtime: linked Messages dispatch often holds that
  # connection for the duration of a run — treating it as idle caused OAuth
  # sync to SIGTERM live chats.
  ss -tnp state established "( dport = :${port} )" 2>/dev/null \
    | awk 'NR>1 && $0 !~ /caddy/ && $0 !~ /sshd/ {c++} END {print c+0}'
}

# True when THIS profile's gateway still has work in its process tree.
# Only inspect MainPID descendants — never global chrome/agent-browser on the host
# (orphans would mark every profile busy forever and block deferred restarts).
pib_hermes_profile_has_agent_work() {
  local profile="$1"
  local unit="hermes@${profile}.service"
  local main_pid
  main_pid=$(systemctl show "$unit" --property=MainPID --value 2>/dev/null || echo 0)
  if [[ ! "$main_pid" =~ ^[1-9][0-9]*$ ]]; then
    return 1
  fi
  # Direct children of this gateway process (tools, shells, browsers launched by it).
  if pgrep -P "$main_pid" >/dev/null 2>&1; then
    return 0
  fi
  return 1
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
    if (( count == 0 )) && ! pib_hermes_profile_has_agent_work "$profile"; then
      echo "drain quiet hermes@${profile} port ${port}"
      return 0
    fi
    if pib_hermes_profile_has_agent_work "$profile"; then
      echo "drain busy hermes@${profile} (agent work in process tree)" >&2
    else
      echo "drain busy hermes@${profile} (${count} established)" >&2
    fi
    return 1
  fi
  started=$(date +%s)
  while true; do
    count=$(pib_hermes_established_count "$port")
    if (( count == 0 )) && ! pib_hermes_profile_has_agent_work "$profile"; then
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
  local sidecar_pending="${PIB_HERMES_SIDECAR_PENDING_DIR:-/var/lib/hermes/hermes-restart-pending}"
  install -d -m 0700 "$PIB_HERMES_PENDING_DIR" 2>/dev/null || true
  install -d -m 0700 "$sidecar_pending" 2>/dev/null || true
  local payload
  payload=$(printf 'profile=%s\nreason=%s\nmarked_at=%s\n' \
    "$profile" "$reason" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
  # Root-owned primary queue (skill staging / sweep as root).
  if [[ -d "$PIB_HERMES_PENDING_DIR" && -w "$PIB_HERMES_PENDING_DIR" ]]; then
    printf '%s\n' "$payload" >"${PIB_HERMES_PENDING_DIR}/${profile}"
    chmod 0600 "${PIB_HERMES_PENDING_DIR}/${profile}"
  fi
  # Hermes-writable queue for the admin sidecar (user=hermes).
  if [[ -d "$sidecar_pending" && -w "$sidecar_pending" ]]; then
    printf '%s\n' "$payload" >"${sidecar_pending}/${profile}"
    chmod 0600 "${sidecar_pending}/${profile}" || true
  fi
  echo "deferred restart hermes@${profile} (${reason})"
}

pib_hermes_clear_pending_restart() {
  local profile="$1"
  local sidecar_pending="${PIB_HERMES_SIDECAR_PENDING_DIR:-/var/lib/hermes/hermes-restart-pending}"
  rm -f "${PIB_HERMES_PENDING_DIR}/${profile}"
  rm -f "${sidecar_pending}/${profile}"
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
