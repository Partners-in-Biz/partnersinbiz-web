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
FLEET_SUPERVISE_INTERVAL_SECONDS="${PIB_LOCAL_RUNTIME_SUPERVISE_INTERVAL_SECONDS:-5}"
PROFILE_STARTUP_GRACE_SECONDS="${PIB_LOCAL_RUNTIME_PROFILE_STARTUP_GRACE_SECONDS:-45}"
PROFILE_RESTART_MAX_BACKOFF_SECONDS="${PIB_LOCAL_RUNTIME_PROFILE_RESTART_MAX_BACKOFF_SECONDS:-30}"
PROFILE_HEALTH_FAILURES_BEFORE_RESTART="${PIB_LOCAL_RUNTIME_PROFILE_HEALTH_FAILURES_BEFORE_RESTART:-3}"
FLEET_SHUTDOWN_GRACE_SECONDS="${PIB_LOCAL_RUNTIME_SHUTDOWN_GRACE_SECONDS:-90}"
TUNNEL_PROBE_INTERVAL_SECONDS="${PIB_LOCAL_RUNTIME_TUNNEL_PROBE_INTERVAL_SECONDS:-30}"
REGISTRATION_MAX_SECONDS="${PIB_LOCAL_RUNTIME_REGISTRATION_MAX_SECONDS:-30}"
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

read_shared_env_value() {
  local key="$1" env_file="$HERMES_ROOT/.env" line value
  [[ -f "$env_file" ]] || return 1
  line=$(grep -E "^${key}=" "$env_file" | head -1 || true)
  [[ -n "$line" ]] || return 1
  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  [[ -n "$value" ]] || return 1
  printf '%s' "$value"
}

API_SERVER_KEY_VALUE="$(read_api_key)"
AI_API_KEY_VALUE="$(read_shared_env_value AI_API_KEY || true)"
PIB_AGENT_API_KEY_VALUE="$(read_shared_env_value PIB_AGENT_API_KEY || true)"
PIB_API_BASE_VALUE="$(read_shared_env_value PIB_API_BASE || true)"
if [[ -z "$AI_API_KEY_VALUE" && -z "$PIB_AGENT_API_KEY_VALUE" ]]; then
  echo "PiB platform API credential missing from $HERMES_ROOT/.env; linked chat could start but authenticated PiB actions would fail" >&2
  exit 1
fi
export AI_API_KEY="$AI_API_KEY_VALUE"
export PIB_AGENT_API_KEY="$PIB_AGENT_API_KEY_VALUE"
export PIB_API_BASE="${PIB_API_BASE_VALUE:-https://partnersinbiz.online/api/v1}"
export HERMES_HOME="$HERMES_ROOT"
export HERMES_YOLO_MODE="${HERMES_YOLO_MODE:-1}"
export PYTHONUNBUFFERED=1

pids=()
profile_started_at=()
profile_retry_after=()
profile_restart_attempts=()
profile_health_failures=()
tunnel_pid=""
vps_tunnel_ok=0
last_tunnel_probe_at=0
last_registration_at=0
register_pid=""
registration_started_at=0

wait_for_pid_exit() {
  local child_pid="$1" max_wait_seconds="${2:-$FLEET_SHUTDOWN_GRACE_SECONDS}" waited=0 max_wait_ticks
  [[ -n "$child_pid" ]] || return 0
  max_wait_ticks=$((max_wait_seconds * 5))
  while kill -0 "$child_pid" >/dev/null 2>&1 && (( waited < max_wait_ticks )); do
    sleep 0.2
    waited=$((waited + 1))
  done
  if kill -0 "$child_pid" >/dev/null 2>&1; then
    kill -KILL "$child_pid" >/dev/null 2>&1 || true
  fi
  wait "$child_pid" >/dev/null 2>&1 || true
}

cleanup() {
  local exit_code=$?
  trap - INT TERM EXIT
  # The SSH tunnel is a child too. Leaving it alive made this parent block
  # forever in a bare `wait`, so launchd believed the fleet was healthy after
  # every Hermes profile had gone away.
  # Stop every profile together, then use one fleet-wide drain deadline. A
  # separate 90-second wait per profile could hold a launchd restart for many
  # minutes when several gateways are stuck at once.
  for child_pid in "${pids[@]:-}" "${tunnel_pid:-}" "${register_pid:-}"; do
    [[ -n "$child_pid" ]] || continue
    kill "$child_pid" >/dev/null 2>&1 || true
  done
  local fleet_deadline=$((SECONDS + FLEET_SHUTDOWN_GRACE_SECONDS)) fleet_has_live_profile=1
  while (( fleet_has_live_profile == 1 && SECONDS < fleet_deadline )); do
    fleet_has_live_profile=0
    for child_pid in "${pids[@]:-}"; do
      [[ -n "$child_pid" ]] || continue
      if kill -0 "$child_pid" >/dev/null 2>&1; then
        fleet_has_live_profile=1
        break
      fi
    done
    (( fleet_has_live_profile == 0 )) || sleep 0.2
  done
  for child_pid in "${pids[@]:-}"; do
    [[ -n "$child_pid" ]] || continue
    if kill -0 "$child_pid" >/dev/null 2>&1; then
      kill -KILL "$child_pid" >/dev/null 2>&1 || true
    fi
    wait "$child_pid" >/dev/null 2>&1 || true
  done
  wait_for_pid_exit "${tunnel_pid:-}" 5
  wait_for_pid_exit "${register_pid:-}" 5
  exit "$exit_code"
}
trap cleanup INT TERM EXIT

write_managed_profile_env() {
  local agent_name="$1" port_value="$2"
  local managed_dir="$MANAGED_ROOT/$agent_name"
  local profile_env="$HERMES_ROOT/profiles/$agent_name/.env"
  local profile_env_tmp="${profile_env}.pib-runtime.$$"
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

  # Native linked-runtime discovery reads each named profile's normal .env,
  # while the Hermes process itself uses the stronger managed scope above.
  # Mirror only the loopback API fields so every healthy managed profile is
  # advertised in heartbeats without replacing provider/profile settings.
  [[ -f "$profile_env" ]] || : > "$profile_env"
  awk '!/^API_SERVER_(ENABLED|HOST|PORT|MODEL_NAME|KEY)=/' "$profile_env" > "$profile_env_tmp"
  {
    printf 'API_SERVER_ENABLED=true\n'
    printf 'API_SERVER_HOST=127.0.0.1\n'
    printf 'API_SERVER_PORT=%s\n' "$port_value"
    printf 'API_SERVER_MODEL_NAME=%s\n' "$agent_name"
    printf 'API_SERVER_KEY=%s\n' "$API_SERVER_KEY_VALUE"
  } >> "$profile_env_tmp"
  chmod 600 "$profile_env_tmp"
  mv "$profile_env_tmp" "$profile_env"
}

start_agent() {
  local agent_name="$1" port_value="$2"
  local managed_dir="$MANAGED_ROOT/$agent_name"
  [[ -d "$HERMES_ROOT/profiles/$agent_name" ]] || { echo "Hermes profile is missing: $agent_name" >&2; return 1; }
  write_managed_profile_env "$agent_name" "$port_value" || return 1
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting local Hermes profile $agent_name on 127.0.0.1:$port_value" | tee -a "$LOG_DIR/fleet.log"
  (
    export HERMES_MANAGED_DIR="$managed_dir"
    exec "$HERMES_BIN" -p "$agent_name" gateway run --replace --force --quiet
  ) >>"$LOG_DIR/$agent_name.log" 2>&1 &
  LAST_STARTED_PID=$!
}

start_agent_at_index() {
  local index="$1"
  if ! start_agent "${AGENTS[$index]}" "${PORTS[$index]}"; then
    return 1
  fi
  pids[$index]="$LAST_STARTED_PID"
  profile_started_at[$index]="$SECONDS"
  return 0
}

profile_is_healthy() {
  local port_value="$1"
  curl --silent --show-error --fail --max-time 1 \
    -H "Authorization: Bearer $API_SERVER_KEY_VALUE" \
    "http://127.0.0.1:$port_value/v1/health" >/dev/null 2>&1
}

healthy_profile_count() {
  local healthy=0 port_value
  for port_value in "${PORTS[@]}"; do
    if profile_is_healthy "$port_value"; then healthy=$((healthy + 1)); fi
  done
  printf '%s' "$healthy"
}

public_url() {
  local agent_name="$1"
  printf '%s' "${PUBLIC_URL_TEMPLATE//\{agent\}/$agent_name}"
}

register_once() {
  local healthy
  healthy="$(healthy_profile_count)"
  # Public legacy registration is optional, but it must never refresh a false
  # healthy timestamp while a profile is down. Native signed heartbeat remains
  # the authority for linked-computer execution availability.
  if (( healthy != ${#AGENTS[@]} )); then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: skipping legacy public registration; only $healthy/${#AGENTS[@]} local Hermes profiles are healthy" | tee -a "$LOG_DIR/fleet.log"
    return 1
  fi
  cd "$REPO" || return 1
  export PIB_LOCAL_RUNTIME_AGENTS="$(IFS=,; echo "${AGENTS[*]}")"
  export PIB_LOCAL_RUNTIME_HOST_ID="$HOST_ID"
  export PIB_LOCAL_RUNTIME_URL_TEMPLATE="$PUBLIC_URL_TEMPLATE"
  export PIB_LOCAL_HERMES_API_KEY="$API_SERVER_KEY_VALUE"
  # register_if_due starts this function inside its own subshell. exec keeps
  # register_pid attached to the real TypeScript process, so a timeout cannot
  # leave an orphaned npx/registration child behind.
  exec "$REPO/node_modules/.bin/tsx" scripts/register-local-agent-runtime.ts
}

profile_restart_delay_seconds() {
  local attempts="$1" exponent="$1" delay
  if (( exponent > 5 )); then exponent=5; fi
  delay=$((2 ** exponent))
  if (( delay > PROFILE_RESTART_MAX_BACKOFF_SECONDS )); then delay="$PROFILE_RESTART_MAX_BACKOFF_SECONDS"; fi
  printf '%s' "$delay"
}

supervise_profile_at_index() {
  # macOS still ships Bash 3.2: declare index first, otherwise nounset can
  # expand it before `local` assigns it and terminate the whole supervisor.
  local index="$1"
  local agent_name="${AGENTS[$index]}" port_value="${PORTS[$index]}"
  local child_pid="${pids[$index]:-}" started_at="${profile_started_at[$index]:-0}"
  local retry_after="${profile_retry_after[$index]:-0}" attempts="${profile_restart_attempts[$index]:-0}"
  local health_failures="${profile_health_failures[$index]:-0}"

  if [[ -n "$child_pid" ]] && kill -0 "$child_pid" >/dev/null 2>&1; then
    if profile_is_healthy "$port_value"; then
      profile_restart_attempts[$index]=0
      profile_retry_after[$index]=0
      profile_health_failures[$index]=0
      return 0
    fi
    # Give a just-spawned gateway time to bind. After that, restart only this
    # profile; the other eleven stay available for their own conversations.
    if (( SECONDS - started_at < PROFILE_STARTUP_GRACE_SECONDS )); then return 0; fi
    health_failures=$((health_failures + 1))
    profile_health_failures[$index]="$health_failures"
    if (( health_failures < PROFILE_HEALTH_FAILURES_BEFORE_RESTART )); then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: local Hermes profile $agent_name missed health probe $health_failures/$PROFILE_HEALTH_FAILURES_BEFORE_RESTART; preserving its active work" | tee -a "$LOG_DIR/fleet.log"
      return 0
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: local Hermes profile $agent_name is unhealthy; restarting only this profile" | tee -a "$LOG_DIR/fleet.log"
    kill "$child_pid" >/dev/null 2>&1 || true
    # Do not leave an unresponsive child behind to consume the port or prevent
    # a replacement gateway from binding. This waits at most five seconds and
    # never touches any healthy sibling.
    wait_for_pid_exit "$child_pid" 5
    pids[$index]=""
    profile_health_failures[$index]=0
    profile_retry_after[$index]=$((SECONDS + 1))
    return 0
  fi

  if [[ -n "$child_pid" ]]; then
    wait "$child_pid" >/dev/null 2>&1 || true
    pids[$index]=""
  fi
  if (( SECONDS < retry_after )); then return 0; fi

  attempts=$((attempts + 1))
  local delay
  delay="$(profile_restart_delay_seconds "$attempts")"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: local Hermes profile $agent_name exited; retrying in ${delay}s (attempt $attempts)" | tee -a "$LOG_DIR/fleet.log"
  if start_agent_at_index "$index"; then
    profile_restart_attempts[$index]="$attempts"
    profile_retry_after[$index]=$((SECONDS + delay))
  else
    profile_restart_attempts[$index]="$attempts"
    profile_retry_after[$index]=$((SECONDS + delay))
  fi
}

for index in "${!AGENTS[@]}"; do
  profile_restart_attempts[$index]=0
  profile_retry_after[$index]=0
  profile_health_failures[$index]=0
  if ! start_agent_at_index "$index"; then
    profile_retry_after[$index]=$((SECONDS + 2))
  fi
  sleep 0.5
done

ssh_args=(-N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3)
for index in "${!REMOTE_PORTS[@]}"; do
  ssh_args+=(-R "127.0.0.1:${REMOTE_PORTS[$index]}:127.0.0.1:${PORTS[$index]}")
done
ssh_args+=("$VPS")

# Reverse tunnel is best-effort. Linked-computer chat claims go through
# pib-runtime → PiB HTTPS and only need healthy loopback Hermes profiles.
# Hard-failing the entire fleet when VPS SSH/port-forward is flaky was
# thrashing all 12 profiles every ~30–40s and marking the Mac offline.
open_reverse_tunnel() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] opening reverse tunnel to $VPS" | tee -a "$LOG_DIR/fleet.log"
  ssh "${ssh_args[@]}" >>"$LOG_DIR/reverse-tunnel.log" 2>&1 &
  tunnel_pid=$!
}

stop_reverse_tunnel() {
  [[ -n "$tunnel_pid" ]] || return 0
  kill "$tunnel_pid" >/dev/null 2>&1 || true
  wait_for_pid_exit "$tunnel_pid" 5
  tunnel_pid=""
}

probe_reverse_tunnel() {
  [[ -n "$tunnel_pid" ]] && kill -0 "$tunnel_pid" >/dev/null 2>&1 || return 1
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$VPS" \
    "curl --silent --show-error --fail --max-time 4 http://127.0.0.1:${REMOTE_PORTS[0]}/v1/health >/dev/null" \
    >/dev/null 2>&1
}

maintain_reverse_tunnel() {
  if [[ -z "$tunnel_pid" ]] || ! kill -0 "$tunnel_pid" >/dev/null 2>&1; then
    tunnel_pid=""
    vps_tunnel_ok=0
    open_reverse_tunnel
    return 0
  fi
  # A live SSH PID is not proof that its forwards are usable. Probe the VPS
  # periodically from the parent process so registration sees the current PID.
  if (( vps_tunnel_ok == 1 && SECONDS - last_tunnel_probe_at < TUNNEL_PROBE_INTERVAL_SECONDS )); then return 0; fi
  last_tunnel_probe_at="$SECONDS"
  if probe_reverse_tunnel; then
    if (( vps_tunnel_ok != 1 )); then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] VPS reverse tunnel recovered" | tee -a "$LOG_DIR/fleet.log"
    fi
    vps_tunnel_ok=1
    return 0
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] VPS reverse tunnel unhealthy; restarting it while local profiles remain up" | tee -a "$LOG_DIR/fleet.log"
  vps_tunnel_ok=0
  stop_reverse_tunnel
}

register_if_due() {
  if [[ -n "$register_pid" ]]; then
    if kill -0 "$register_pid" >/dev/null 2>&1; then
      if (( SECONDS - registration_started_at >= REGISTRATION_MAX_SECONDS )); then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: legacy registration exceeded ${REGISTRATION_MAX_SECONDS}s; stopping it without pausing local profile recovery" | tee -a "$LOG_DIR/fleet.log"
        kill "$register_pid" >/dev/null 2>&1 || true
        wait_for_pid_exit "$register_pid" 5
        register_pid=""
        registration_started_at=0
      else
        return 0
      fi
    else
      wait "$register_pid" >/dev/null 2>&1 || true
      register_pid=""
      registration_started_at=0
    fi
  fi
  (( vps_tunnel_ok == 1 )) || return 0
  if (( last_registration_at > 0 && SECONDS - last_registration_at < REGISTER_INTERVAL_SECONDS )); then return 0; fi
  last_registration_at="$SECONDS"
  registration_started_at="$SECONDS"
  # Firebase/DNS stalls in optional legacy registration must not block the
  # parent supervisor that owns profile and reverse-tunnel recovery.
  ( register_once ) >>"$LOG_DIR/register.log" 2>&1 &
  register_pid=$!
}

open_reverse_tunnel
initial_healthy="$(healthy_profile_count)"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] local runtime fleet started ($initial_healthy/${#AGENTS[@]} profiles currently healthy); supervising" | tee -a "$LOG_DIR/fleet.log"
while true; do
  sleep "$FLEET_SUPERVISE_INTERVAL_SECONDS"
  # A single profile failure is recoverable. Keep every healthy profile and
  # the native PiB runtime alive while the failed profile restarts with a
  # bounded backoff.
  for index in "${!AGENTS[@]}"; do supervise_profile_at_index "$index"; done
  # Tunnel and public registration are optional. Neither may delay or stop
  # local linked-computer execution while an SSH route is recovering.
  maintain_reverse_tunnel
  register_if_due
done
