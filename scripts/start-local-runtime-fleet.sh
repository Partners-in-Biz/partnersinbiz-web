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
# Planned profile replace must drain active /v1/runs before SIGKILL. Five seconds
# was short enough to orphan Kanban runs and leave the port half-bound.
PROFILE_DRAIN_GRACE_SECONDS="${PIB_LOCAL_RUNTIME_PROFILE_DRAIN_GRACE_SECONDS:-120}"
PROFILE_BUSY_DEFER_SECONDS="${PIB_LOCAL_RUNTIME_PROFILE_BUSY_DEFER_SECONDS:-30}"
FLEET_SHUTDOWN_GRACE_SECONDS="${PIB_LOCAL_RUNTIME_SHUTDOWN_GRACE_SECONDS:-90}"
TUNNEL_PROBE_INTERVAL_SECONDS="${PIB_LOCAL_RUNTIME_TUNNEL_PROBE_INTERVAL_SECONDS:-30}"
REGISTRATION_MAX_SECONDS="${PIB_LOCAL_RUNTIME_REGISTRATION_MAX_SECONDS:-30}"
LOG_DIR="$HERMES_ROOT/logs/local-runtime"
MANAGED_ROOT="$REPO/.runtime/local-hermes-managed"
# The runtime writes one atomically-replaced request per profile here. Keeping
# control state under HERMES_ROOT lets the launch agent and pib-runtime agree
# even when they have different working directories.
FLEET_CONTROL_DIR="${PIB_HERMES_FLEET_CONTROL_DIR:-$HERMES_ROOT/runtime-fleet-control}"

AGENTS=(pip theo maya sage nora ads qa-release support data docs seo sales)
PORTS=(8755 8756 8757 8758 8759 8767 8768 8769 8770 8771 8772 8773)
REMOTE_PORTS=(18755 18756 18757 18758 18759 18767 18768 18769 18770 18771 18772 18773)

mkdir -p "$LOG_DIR" "$MANAGED_ROOT" "$FLEET_CONTROL_DIR/requests" "$FLEET_CONTROL_DIR/disabled" "$FLEET_CONTROL_DIR/acks"
chmod 700 "$MANAGED_ROOT"
chmod 700 "$FLEET_CONTROL_DIR" "$FLEET_CONTROL_DIR/requests" "$FLEET_CONTROL_DIR/disabled" "$FLEET_CONTROL_DIR/acks"

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
  # Drop stale listeners before bind so "address already in use" cannot leave
  # /health on a new process while the prior run state is gone.
  ensure_profile_port_free "${PORTS[$index]}"
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

# True (exit 0) when this profile still owns live API runs, gateway agents,
# process children, or non-keepalive established clients on the API port.
# Credential/policy reloads must not SIGTERM a healthy Kanban /v1/runs worker.
profile_has_active_work() {
  local agent_name="$1" port_value="$2" child_pid="${3:-}" detail active_runs active_agents gateway_busy
  if [[ -n "$child_pid" ]] && kill -0 "$child_pid" >/dev/null 2>&1; then
    if pgrep -P "$child_pid" >/dev/null 2>&1; then
      return 0
    fi
  fi
  detail=$(curl --silent --show-error --max-time 2 \
    -H "Authorization: Bearer $API_SERVER_KEY_VALUE" \
    "http://127.0.0.1:$port_value/health/detailed" 2>/dev/null || true)
  if [[ -n "$detail" ]]; then
    active_runs=$(printf '%s' "$detail" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin)
 q=((d.get("readiness") or {}).get("checks") or {}).get("background_queues") or {}
 print(int(q.get("active_api_runs") or 0))
except Exception:
 print(0)' 2>/dev/null || printf '0')
    active_agents=$(printf '%s' "$detail" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin)
 v=d.get("active_agents") or 0
 if isinstance(v, (int, float)):
  print(int(v))
 elif isinstance(v, str) and v.isdigit():
  print(int(v))
 else:
  print(0)
except Exception:
 print(0)' 2>/dev/null || printf '0')
    gateway_busy=$(printf '%s' "$detail" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin)
 print("1" if d.get("gateway_busy") else "0")
except Exception:
 print("0")' 2>/dev/null || printf '0')
    if [[ "$active_runs" =~ ^[0-9]+$ && "$active_agents" =~ ^[0-9]+$ && "$gateway_busy" =~ ^[01]$ ]]; then
      if (( active_runs > 0 || active_agents > 0 || gateway_busy == 1 )); then
        return 0
      fi
    fi
  fi
  # Established clients on the API port usually mean a poller still holds a run.
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port_value" -sTCP:ESTABLISHED 2>/dev/null \
      | awk 'NR>1 && $1 !~ /sshd|caddy/ {found=1} END {exit found?0:1}'; then
      return 0
    fi
  fi
  return 1
}

ensure_profile_port_free() {
  local port_value="$1" keep_pid="${2:-}" listener_pids pid
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  listener_pids=$(lsof -nP -iTCP:"$port_value" -sTCP:LISTEN -t 2>/dev/null || true)
  for pid in $listener_pids; do
    [[ -n "$pid" ]] || continue
    if [[ -n "$keep_pid" && "$pid" == "$keep_pid" ]]; then
      continue
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: clearing stale listener pid $pid on 127.0.0.1:$port_value before profile start" | tee -a "$LOG_DIR/fleet.log"
    kill "$pid" >/dev/null 2>&1 || true
    wait_for_pid_exit "$pid" 3
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -KILL "$pid" >/dev/null 2>&1 || true
      wait_for_pid_exit "$pid" 2
    fi
  done
}

drain_stop_profile_pid() {
  local child_pid="$1" agent_name="$2" port_value="$3" grace="${4:-$PROFILE_DRAIN_GRACE_SECONDS}"
  local deadline=$((SECONDS + grace))
  [[ -n "$child_pid" ]] || return 0
  if ! kill -0 "$child_pid" >/dev/null 2>&1; then
    wait "$child_pid" >/dev/null 2>&1 || true
    ensure_profile_port_free "$port_value"
    return 0
  fi
  # Cooperative first: Hermes marks active runs interrupted and refuses new work.
  kill -TERM "$child_pid" >/dev/null 2>&1 || true
  while kill -0 "$child_pid" >/dev/null 2>&1 && (( SECONDS < deadline )); do
    sleep 0.2
  done
  if kill -0 "$child_pid" >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: local Hermes profile $agent_name still alive after ${grace}s drain; forcing stop" | tee -a "$LOG_DIR/fleet.log"
    kill -KILL "$child_pid" >/dev/null 2>&1 || true
    wait_for_pid_exit "$child_pid" 3
  else
    wait "$child_pid" >/dev/null 2>&1 || true
  fi
  ensure_profile_port_free "$port_value"
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

write_profile_control_ack() {
  local agent_name="$1" action="$2" request_id="$3" status="$4" error_text="${5:-}"
  local ack_path="$FLEET_CONTROL_DIR/acks/${agent_name}.${request_id}.json"
  local ack_tmp="${ack_path}.tmp.$$"
  umask 077
  if [[ -n "$error_text" ]]; then
    # Agent IDs and request IDs are generated by pib-runtime; this keeps an
    # error acknowledgement parseable without bringing a JSON dependency into
    # macOS's stock Bash 3.2 supervisor.
    error_text="${error_text//\\/\\\\}"
    error_text="${error_text//\"/\\\"}"
    printf '{"version":1,"action":"%s","agentId":"%s","requestId":"%s","status":"%s","error":"%s"}\n' \
      "$action" "$agent_name" "$request_id" "$status" "$error_text" > "$ack_tmp"
  else
    printf '{"version":1,"action":"%s","agentId":"%s","requestId":"%s","status":"%s"}\n' \
      "$action" "$agent_name" "$request_id" "$status" > "$ack_tmp"
  fi
  chmod 600 "$ack_tmp"
  mv "$ack_tmp" "$ack_path"
}

profile_is_disabled() {
  local agent_name="$1"
  [[ -f "$FLEET_CONTROL_DIR/disabled/${agent_name}.json" ]]
}

write_profile_disabled_marker() {
  local agent_name="$1" request_id="$2"
  local marker_path="$FLEET_CONTROL_DIR/disabled/${agent_name}.json"
  local marker_tmp="${marker_path}.tmp.$$"
  umask 077
  printf '{"version":1,"agentId":"%s","requestId":"%s","disabledAt":"%s"}\n' \
    "$agent_name" "$request_id" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$marker_tmp"
  chmod 600 "$marker_tmp"
  mv "$marker_tmp" "$marker_path"
}

stop_profile_at_index() {
  local index="$1" child_pid="${pids[$index]:-}"
  local agent_name="${AGENTS[$index]}" port_value="${PORTS[$index]}"
  if [[ -n "$child_pid" ]]; then
    drain_stop_profile_pid "$child_pid" "$agent_name" "$port_value" "$PROFILE_DRAIN_GRACE_SECONDS"
  else
    ensure_profile_port_free "$port_value"
  fi
  pids[$index]=""
  profile_health_failures[$index]=0
  profile_restart_attempts[$index]=0
  profile_retry_after[$index]=0
}

consume_profile_control_request_at_index() {
  local index="$1"
  local agent_name="${AGENTS[$index]}" request_path="$FLEET_CONTROL_DIR/requests/${agent_name}.json"
  local claimed_path="$FLEET_CONTROL_DIR/requests/.${agent_name}.processing.$$"
  local request_id request_action request_agent request_deferred retry_after="${profile_retry_after[$index]:-0}"
  [[ -f "$request_path" ]] || return 1
  # A deferred busy-restart stays on disk until PROFILE_BUSY_DEFER elapses so
  # we do not thrash logs / acks every supervise tick while a Kanban run lives.
  if grep -q '"deferred"[[:space:]]*:[[:space:]]*true' "$request_path" 2>/dev/null; then
    if (( SECONDS < retry_after )); then
      return 0
    fi
  fi
  # Claim by rename before reading it. A newer atomic write remains in the
  # requests directory for the next tick, so only the latest intended action
  # for this profile can be acted on.
  mv "$request_path" "$claimed_path" 2>/dev/null || return 1
  request_id="$(sed -n 's/.*"requestId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$claimed_path" | head -n 1)"
  request_action="$(sed -n 's/.*"action"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$claimed_path" | head -n 1)"
  request_agent="$(sed -n 's/.*"agentId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$claimed_path" | head -n 1)"
  request_deferred="$(grep -q '"deferred"[[:space:]]*:[[:space:]]*true' "$claimed_path" 2>/dev/null && echo 1 || echo 0)"
  rm -f "$claimed_path"
  if [[ -z "$request_id" || "$request_agent" != "$agent_name" || ! "$request_action" =~ ^(restart|disable|enable)$ ]]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: ignored malformed profile control request for $agent_name" | tee -a "$LOG_DIR/fleet.log"
    return 0
  fi

  case "$request_action" in
    restart)
      if profile_is_disabled "$agent_name"; then
        write_profile_control_ack "$agent_name" "restart" "$request_id" "failed" "profile is disabled"
        return 0
      fi
      # Never kill a profile with live /v1/runs. Credential sync only knows about
      # linked-chat capacity; Kanban watcher runs arrive over the reverse tunnel.
      if profile_has_active_work "$agent_name" "${PORTS[$index]}" "${pids[$index]:-}"; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] deferring requested restart for busy local Hermes profile $agent_name (active run)" | tee -a "$LOG_DIR/fleet.log"
        # Re-queue the same intent so the supervisor retries after the run drains.
        printf '{"version":1,"action":"restart","agentId":"%s","requestId":"%s","requestedAt":"%s","deferred":true}\n'           "$agent_name" "$request_id" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$FLEET_CONTROL_DIR/requests/${agent_name}.json"
        chmod 600 "$FLEET_CONTROL_DIR/requests/${agent_name}.json"
        write_profile_control_ack "$agent_name" "restart" "$request_id" "deferred" "profile has active /v1/runs; restart deferred"
        profile_retry_after[$index]=$((SECONDS + PROFILE_BUSY_DEFER_SECONDS))
        return 0
      fi
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] restarting requested local Hermes profile $agent_name only" | tee -a "$LOG_DIR/fleet.log"
      stop_profile_at_index "$index"
      if start_agent_at_index "$index"; then
        write_profile_control_ack "$agent_name" "restart" "$request_id" "restarted"
      else
        profile_retry_after[$index]=$((SECONDS + 2))
        write_profile_control_ack "$agent_name" "restart" "$request_id" "failed" "profile process could not be started"
      fi
      ;;
    disable)
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] disabling requested local Hermes profile $agent_name only" | tee -a "$LOG_DIR/fleet.log"
      stop_profile_at_index "$index"
      write_profile_disabled_marker "$agent_name" "$request_id"
      write_profile_control_ack "$agent_name" "disable" "$request_id" "disabled"
      ;;
    enable)
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] enabling requested local Hermes profile $agent_name only" | tee -a "$LOG_DIR/fleet.log"
      rm -f "$FLEET_CONTROL_DIR/disabled/${agent_name}.json"
      stop_profile_at_index "$index"
      if start_agent_at_index "$index"; then
        write_profile_control_ack "$agent_name" "enable" "$request_id" "enabled"
      else
        profile_retry_after[$index]=$((SECONDS + 2))
        write_profile_control_ack "$agent_name" "enable" "$request_id" "failed" "profile process could not be started"
      fi
      ;;
  esac
  return 0
}

supervise_profile_at_index() {
  # macOS still ships Bash 3.2: declare index first, otherwise nounset can
  # expand it before `local` assigns it and terminate the whole supervisor.
  local index="$1"
  local agent_name="${AGENTS[$index]}" port_value="${PORTS[$index]}"
  local child_pid="${pids[$index]:-}" started_at="${profile_started_at[$index]:-0}"
  local retry_after="${profile_retry_after[$index]:-0}" attempts="${profile_restart_attempts[$index]:-0}"
  local health_failures="${profile_health_failures[$index]:-0}"

  # Agent-host lifecycle jobs use one ordered request per profile rather than
  # restarting the launchd fleet. They only ever terminate the requested
  # profile, and a newer request replaces any older pending action.
  if consume_profile_control_request_at_index "$index"; then return 0; fi
  if profile_is_disabled "$agent_name"; then return 0; fi

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
    # If health flaps while a run is live, keep the process. Killing it is how
    # docs/qa Kanban cards turned into 502/run_not_found mid-flight.
    if profile_has_active_work "$agent_name" "$port_value" "$child_pid"; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: local Hermes profile $agent_name missed health but still has active work; deferring restart" | tee -a "$LOG_DIR/fleet.log"
      profile_health_failures[$index]=0
      return 0
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: local Hermes profile $agent_name is unhealthy; restarting only this profile" | tee -a "$LOG_DIR/fleet.log"
    drain_stop_profile_pid "$child_pid" "$agent_name" "$port_value" "$PROFILE_DRAIN_GRACE_SECONDS"
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
  if profile_is_disabled "${AGENTS[$index]}"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] local Hermes profile ${AGENTS[$index]} remains disabled" | tee -a "$LOG_DIR/fleet.log"
  elif ! start_agent_at_index "$index"; then
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
  # A single profile failure is recoverable. Keep every healthy profile and
  # the native PiB runtime alive while the failed profile restarts with a
  # bounded backoff. Run this before the first sleep so control requests that
  # arrive during launchd startup are acknowledged within the lifecycle
  # timeout instead of waiting through a full additional poll interval.
  for index in "${!AGENTS[@]}"; do supervise_profile_at_index "$index"; done
  # Tunnel and public registration are optional. Neither may delay or stop
  # local linked-computer execution while an SSH route is recovering.
  maintain_reverse_tunnel
  register_if_due
  sleep "$FLEET_SUPERVISE_INTERVAL_SECONDS"
done
