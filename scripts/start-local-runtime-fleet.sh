#!/usr/bin/env bash
# Supervise Peet's Mac as the authenticated Partners in Biz local Hermes node.
# Profile runtime settings are applied through Hermes managed scope so stale
# per-profile .env files cannot silently override ports after a Hermes update.
set -euo pipefail

export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${PIB_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
HERMES_ROOT="${HERMES_HOME:-/Users/peetstander/.hermes}"
HERMES_BIN="${PIB_HERMES_BIN:-$HERMES_ROOT/hermes-agent/venv/bin/hermes}"
VPS="${PIB_LOCAL_RUNTIME_VPS:-root@65.108.146.144}"
HOST_ID="${PIB_LOCAL_RUNTIME_HOST_ID:-peets-mac-mini}"
if [[ -n "${PIB_LOCAL_RUNTIME_URL_TEMPLATE:-}" ]]; then
  PUBLIC_URL_TEMPLATE="$PIB_LOCAL_RUNTIME_URL_TEMPLATE"
else
  PUBLIC_URL_TEMPLATE='https://hermes-api.partnersinbiz.online/local-profiles/{agent}'
fi
REGISTER_INTERVAL_SECONDS="${PIB_LOCAL_RUNTIME_REGISTER_INTERVAL_SECONDS:-60}"
STARTUP_TIMEOUT_SECONDS="${PIB_LOCAL_RUNTIME_STARTUP_TIMEOUT_SECONDS:-90}"
LOG_DIR="$HERMES_ROOT/logs/local-runtime"
MANAGED_ROOT="$REPO/.runtime/local-hermes-managed"

AGENTS=(pip theo maya sage nora ads qa-release support data docs seo sales)
PORTS=(8755 8756 8757 8758 8759 8767 8768 8769 8770 8771 8772 8773)
REMOTE_PORTS=(18755 18756 18757 18758 18759 18767 18768 18769 18770 18771 18772 18773)

mkdir -p "$LOG_DIR" "$MANAGED_ROOT"
chmod 700 "$MANAGED_ROOT"

if [[ ! -x "$HERMES_BIN" ]]; then
  echo "Hermes is not installed at $HERMES_BIN" >&2
  exit 1
fi
if [[ ! -d "$REPO" ]]; then
  echo "Partners in Biz repo is missing: $REPO" >&2
  exit 1
fi

read_api_key() {
  local env_file="$HERMES_ROOT/.env"
  local line value
  [[ -f "$env_file" ]] || { echo "Missing $env_file" >&2; return 1; }
  line=$(grep -E '^API_SERVER_KEY=' "$env_file" | tail -1 || true)
  [[ -n "$line" ]] || { echo "API_SERVER_KEY missing from $env_file" >&2; return 1; }
  value="${line#API_SERVER_KEY=}"
  value="${value%$'\r'}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  [[ -n "$value" ]] || { echo "API_SERVER_KEY is empty in $env_file" >&2; return 1; }
  printf '%s' "$value"
}

API_SERVER_KEY_VALUE="$(read_api_key)"
export HERMES_HOME="$HERMES_ROOT"
export HERMES_YOLO_MODE="${HERMES_YOLO_MODE:-1}"
export PYTHONUNBUFFERED=1

pids=()
cleanup() {
  local exit_code=$?
  trap - INT TERM EXIT
  for child_pid in "${pids[@]:-}"; do kill "$child_pid" >/dev/null 2>&1 || true; done
  wait >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup INT TERM EXIT

write_managed_profile_env() {
  local agent_name="$1" port_value="$2"
  local managed_dir="$MANAGED_ROOT/$agent_name"
  mkdir -p "$managed_dir"
  chmod 700 "$managed_dir"
  umask 077
  {
    printf 'API_SERVER_ENABLED=true\n'
    printf 'API_SERVER_HOST=127.0.0.1\n'
    printf 'API_SERVER_PORT=%s\n' "$port_value"
    printf 'API_SERVER_MODEL_NAME=%s\n' "$agent_name"
    printf 'API_SERVER_KEY=%s\n' "$API_SERVER_KEY_VALUE"
    printf 'WHATSAPP_ENABLED=false\n'
  } > "$managed_dir/.env"
  chmod 600 "$managed_dir/.env"
}

start_agent() {
  local agent_name="$1" port_value="$2"
  local managed_dir="$MANAGED_ROOT/$agent_name"
  [[ -d "$HERMES_ROOT/profiles/$agent_name" ]] || { echo "Hermes profile is missing: $agent_name" >&2; exit 1; }
  write_managed_profile_env "$agent_name" "$port_value"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting local Hermes profile $agent_name on 127.0.0.1:$port_value" | tee -a "$LOG_DIR/fleet.log"
  (
    export HERMES_MANAGED_DIR="$managed_dir"
    exec "$HERMES_BIN" -p "$agent_name" gateway run --replace --force --quiet
  ) >>"$LOG_DIR/$agent_name.log" 2>&1 &
  pids+=("$!")
}

wait_for_local_profiles() {
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    local healthy=0
    for port_value in "${PORTS[@]}"; do
      if curl --silent --show-error --fail --max-time 3 \
        -H "Authorization: Bearer $API_SERVER_KEY_VALUE" \
        "http://127.0.0.1:$port_value/v1/health" >/dev/null 2>&1; then
        healthy=$((healthy + 1))
      fi
    done
    if (( healthy == ${#PORTS[@]} )); then return 0; fi
    sleep 2
  done
  echo "Only some local Hermes profiles became healthy before timeout" >&2
  return 1
}

public_url() {
  local agent_name="$1"
  printf '%s' "${PUBLIC_URL_TEMPLATE//\{agent\}/$agent_name}"
}

wait_for_vps_profiles() {
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
  local health_command=""
  local remote_port
  for remote_port in "${REMOTE_PORTS[@]}"; do
    health_command+="curl --silent --show-error --fail --max-time 4 http://127.0.0.1:$remote_port/v1/health >/dev/null || exit 1;"
  done
  while (( SECONDS < deadline )); do
    if ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS" "$health_command" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "The VPS tunnel did not expose every local Hermes profile before timeout" >&2
  return 1
}

register_once() {
  (
    cd "$REPO"
    PIB_LOCAL_RUNTIME_AGENTS="$(IFS=,; echo "${AGENTS[*]}")" \
    PIB_LOCAL_RUNTIME_HOST_ID="$HOST_ID" \
    PIB_LOCAL_RUNTIME_URL_TEMPLATE="$PUBLIC_URL_TEMPLATE" \
    PIB_LOCAL_HERMES_API_KEY="$API_SERVER_KEY_VALUE" \
      npx tsx scripts/register-local-agent-runtime.ts
  ) >>"$LOG_DIR/register.log" 2>&1
}

for index in "${!AGENTS[@]}"; do
  start_agent "${AGENTS[$index]}" "${PORTS[$index]}"
  sleep 0.5
done

wait_for_local_profiles

ssh_args=(-N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3)
for index in "${!REMOTE_PORTS[@]}"; do
  ssh_args+=(-R "127.0.0.1:${REMOTE_PORTS[$index]}:127.0.0.1:${PORTS[$index]}")
done
ssh_args+=("$VPS")

echo "[$(date '+%Y-%m-%d %H:%M:%S')] opening reverse tunnel to $VPS" | tee -a "$LOG_DIR/fleet.log"
ssh "${ssh_args[@]}" >>"$LOG_DIR/reverse-tunnel.log" 2>&1 &
pids+=("$!")

wait_for_vps_profiles
register_once

(
  while true; do
    sleep "$REGISTER_INTERVAL_SECONDS"
    register_once || true
  done
) &
pids+=("$!")

echo "[$(date '+%Y-%m-%d %H:%M:%S')] local runtime fleet healthy (${#AGENTS[@]} profiles); supervising" | tee -a "$LOG_DIR/fleet.log"
while true; do
  sleep 15
  for child_pid in "${pids[@]}"; do
    if ! kill -0 "$child_pid" >/dev/null 2>&1; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] local runtime child $child_pid exited; stopping fleet" | tee -a "$LOG_DIR/fleet.log"
      exit 1
    fi
  done
done
