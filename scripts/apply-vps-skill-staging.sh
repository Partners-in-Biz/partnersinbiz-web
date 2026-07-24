#!/usr/bin/env bash
# Root-owned installer for a skill bundle staged by the unprivileged
# hermes-deploy GitHub Actions account. Install this file at
# /usr/local/sbin/pib-apply-skill-staging (root:root, 0755) and allow only that
# command through sudo. The staging tree is data; no script is executed from it.
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "pib skill staging installer must run as root" >&2
  exit 1
fi

raw_staging=${1:-}
if [[ -z "$raw_staging" ]]; then
  echo "usage: pib-apply-skill-staging <staging-directory>" >&2
  exit 2
fi

staging=$(realpath -e -- "$raw_staging")
if [[ ! "$staging" =~ ^/srv/hermes-projects/pib-skill-staging/[0-9]+-[0-9]+$ ]]; then
  echo "refusing unexpected staging path: $staging" >&2
  exit 2
fi
if [[ $(stat -c '%U' "$staging") != hermes-deploy ]]; then
  echo "staging directory must be owned by hermes-deploy" >&2
  exit 2
fi
if find -P "$staging" -type l -print -quit | grep -q .; then
  echo "staging directory must not contain symlinks" >&2
  exit 2
fi

required=(
  "$staging/.claude/skills"
  "$staging/config/agent-skill-policy.json"
  "$staging/scripts/apply-agent-skill-policy.mjs"
  "$staging/scripts/install-vps-skills.sh"
)
for path in "${required[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "staging bundle is incomplete: $path" >&2
    exit 2
  fi
done

trap 'rm -rf -- "$staging"' EXIT

install -d -o hermes -g hermes -m 2770 \
  /var/lib/hermes/pib-skills/partnersinbiz \
  /var/lib/hermes/partnersinbiz-web/config \
  /var/lib/hermes/partnersinbiz-web/scripts

rsync -rl --delete --omit-dir-times --no-perms --no-owner --no-group \
  "$staging/.claude/skills/" \
  /var/lib/hermes/pib-skills/partnersinbiz/
install -o hermes -g hermes -m 0644 \
  "$staging/config/agent-skill-policy.json" \
  /var/lib/hermes/partnersinbiz-web/config/agent-skill-policy.json
install -o hermes -g hermes -m 0755 \
  "$staging/scripts/apply-agent-skill-policy.mjs" \
  "$staging/scripts/install-vps-skills.sh" \
  /var/lib/hermes/partnersinbiz-web/scripts/
chown -R hermes:hermes /var/lib/hermes/pib-skills/partnersinbiz

sudo -u hermes env HOME=/var/lib/hermes /usr/bin/node \
  /var/lib/hermes/partnersinbiz-web/scripts/apply-agent-skill-policy.mjs \
  --root /var/lib/hermes --apply --no-config --allow-missing-global

mapfile -t active_units < <(
  systemctl list-units 'hermes@*.service' --state=running --no-legend --plain \
    | awk '{print $1}'
)
if (( ${#active_units[@]} > 0 )); then
  # Rolling restart with drain + health gates.
  # Never bounce the whole fleet at once (Blake outage 2026-07-23).
  # Before each restart, wait for the profile API port to go quiet so an
  # in-flight /v1/runs (SSE) can finish. After restart, wait for /v1/health.
  gap_seconds=${PIB_SKILL_RESTART_GAP_SECONDS:-2}
  if [[ ! "$gap_seconds" =~ ^[0-9]+$ ]]; then
    echo "PIB_SKILL_RESTART_GAP_SECONDS must be a non-negative integer" >&2
    exit 2
  fi
  drain_seconds=${PIB_SKILL_RESTART_DRAIN_SECONDS:-90}
  if [[ ! "$drain_seconds" =~ ^[0-9]+$ ]]; then
    echo "PIB_SKILL_RESTART_DRAIN_SECONDS must be a non-negative integer" >&2
    exit 2
  fi
  quiet_seconds=${PIB_SKILL_RESTART_QUIET_SECONDS:-3}
  if [[ ! "$quiet_seconds" =~ ^[0-9]+$ ]]; then
    echo "PIB_SKILL_RESTART_QUIET_SECONDS must be a non-negative integer" >&2
    exit 2
  fi
  health_seconds=${PIB_SKILL_RESTART_HEALTH_SECONDS:-45}
  if [[ ! "$health_seconds" =~ ^[0-9]+$ ]]; then
    echo "PIB_SKILL_RESTART_HEALTH_SECONDS must be a non-negative integer" >&2
    exit 2
  fi
  stabilization_seconds=${PIB_SKILL_RESTART_STABILIZATION_SECONDS:-15}
  if [[ ! "$stabilization_seconds" =~ ^[0-9]+$ ]]; then
    echo "PIB_SKILL_RESTART_STABILIZATION_SECONDS must be a non-negative integer" >&2
    exit 2
  fi

  profile_port() {
    local profile="$1" env_file port
    env_file="/etc/hermes/profiles/${profile}.env"
    [[ -f "$env_file" ]] || return 1
    port=$(awk -F= '/^API_SERVER_PORT=/{gsub(/"/,"",$2); print $2; exit}' "$env_file")
    [[ "$port" =~ ^[0-9]+$ ]] || return 1
    printf '%s\n' "$port"
  }

  profile_api_key() {
    local profile="$1" env_file
    env_file="/etc/hermes/profiles/${profile}.env"
    [[ -f "$env_file" ]] || return 1
    awk -F= '/^API_SERVER_KEY=/{gsub(/^"|"$/,"",$2); print $2; exit}' "$env_file"
  }

  established_count() {
    local port="$1"
    # Count peer connections to the Hermes API port (active runs hold SSE).
    ss -tn state established "( sport = :${port} )" 2>/dev/null \
      | awk 'NR>1 {c++} END {print c+0}'
  }

  wait_for_quiet_port() {
    local profile="$1" port quiet_needed="$2" max_wait="$3"
    local started now quiet_streak=0 count
    port=$(profile_port "$profile") || {
      echo "drain skip for ${profile}: no API_SERVER_PORT" >&2
      return 0
    }
    started=$(date +%s)
    while true; do
      now=$(date +%s)
      if (( now - started >= max_wait )); then
        echo "drain timeout for hermes@${profile} after ${max_wait}s (proceeding)" >&2
        return 0
      fi
      count=$(established_count "$port")
      if (( count == 0 )); then
        quiet_streak=$((quiet_streak + 1))
        if (( quiet_streak >= quiet_needed )); then
          echo "drain quiet hermes@${profile} port ${port}"
          return 0
        fi
      else
        quiet_streak=0
      fi
      sleep 1
    done
  }

  wait_for_health() {
    local profile="$1" max_wait="$2"
    local port key started now code
    port=$(profile_port "$profile") || return 0
    key=$(profile_api_key "$profile") || return 0
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

  declare -A restart_baseline=()
  for unit in "${active_units[@]}"; do
    profile=${unit#hermes@}
    profile=${profile%.service}
    restart_baseline["$unit"]=$(systemctl show "$unit" --property=NRestarts --value)
    wait_for_quiet_port "$profile" "$quiet_seconds" "$drain_seconds"
    systemctl restart "$unit"
    systemctl is-active "$unit"
    wait_for_health "$profile" "$health_seconds"
    if (( gap_seconds > 0 )); then
      sleep "$gap_seconds"
    fi
  done

  # A syntax/import failure can leave a Restart=always unit momentarily active
  # before it falls into a crash loop. Do not report a successful skill sync
  # until every restarted profile survives a stabilization window without
  # incrementing its restart counter.
  sleep "$stabilization_seconds"
  systemctl is-active "${active_units[@]}"
  for unit in "${active_units[@]}"; do
    current_restarts=$(systemctl show "$unit" --property=NRestarts --value)
    if (( current_restarts > restart_baseline["$unit"] )); then
      echo "$unit restarted during the ${stabilization_seconds}s stabilization window" >&2
      exit 1
    fi
  done
fi

logger -t pib-skill-sync "applied staged PiB agent skills with drained rolling restart of ${#active_units[@]} active profiles"
echo "PiB skill staging apply complete"
