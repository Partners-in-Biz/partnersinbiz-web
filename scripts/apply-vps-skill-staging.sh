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

# Shared drain/restart helpers (installed next to this script on the VPS).
RESTART_LIB="$(cd "$(dirname "$0")" && pwd)/pib-hermes-profile-restart-lib.sh"
if [[ ! -f "$RESTART_LIB" ]]; then
  RESTART_LIB=/usr/local/lib/partnersinbiz/pib-hermes-profile-restart-lib.sh
fi
# shellcheck source=/dev/null
source "$RESTART_LIB"

mapfile -t active_units < <(
  systemctl list-units 'hermes@*.service' --state=running --no-legend --plain \
    | awk '{print $1}'
)
if (( ${#active_units[@]} > 0 )); then
  # Rolling restart with drain + health gates.
  # Never bounce the whole fleet at once (Blake outage 2026-07-23).
  # Never force-kill multi-hour runs: if a profile is still busy after the
  # soft drain window, skills stay on disk and restart is deferred to the
  # pib-hermes-deferred-restart.timer sweeper.
  gap_seconds=${PIB_SKILL_RESTART_GAP_SECONDS:-2}
  if [[ ! "$gap_seconds" =~ ^[0-9]+$ ]]; then
    echo "PIB_SKILL_RESTART_GAP_SECONDS must be a non-negative integer" >&2
    exit 2
  fi
  # Soft wait only — long runs defer instead of being killed.
  drain_seconds=${PIB_SKILL_RESTART_DRAIN_SECONDS:-120}
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

  restarted_units=()
  deferred_units=()
  for unit in "${active_units[@]}"; do
    profile=${unit#hermes@}
    profile=${profile%.service}
    set +e
    pib_hermes_restart_profile_when_idle "$profile" "$quiet_seconds" "$drain_seconds" "$health_seconds" "$gap_seconds"
    rc=$?
    set -e
    if (( rc == 0 )); then
      restarted_units+=("$unit")
    elif (( rc == 2 )); then
      deferred_units+=("$unit")
    else
      echo "hard failure restarting ${unit}" >&2
      exit 1
    fi
  done

  # Extra settle only for profiles restarted in this pass (crash-loop already gated).
  # Skills are already on disk before any restart. A slow/activating unit must NOT
  # fail the GitHub Actions job (exit 3 from `systemctl is-active` was a false red
  # after 2026-08-11 hire/skill push when only hermes@default restarted and was
  # still activating during the settle window). Re-queue unstable units instead.
  if (( ${#restarted_units[@]} > 0 && stabilization_seconds > 0 )); then
    sleep "$stabilization_seconds"
    unstable_units=()
    for unit in "${restarted_units[@]}"; do
      state=$(systemctl is-active "$unit" 2>/dev/null || true)
      printf '%s\n' "$state"
      if [[ "$state" != "active" ]]; then
        unstable_units+=("$unit")
      fi
    done
    if (( ${#unstable_units[@]} > 0 )); then
      echo "warning: restarted units not fully active after stabilization: ${unstable_units[*]}" >&2
      for unit in "${unstable_units[@]}"; do
        profile=${unit#hermes@}
        profile=${profile%.service}
        pib_hermes_mark_pending_restart "$profile" "post-restart-not-active"
        deferred_units+=("$unit")
      done
    fi
  fi

  logger -t pib-skill-sync \
    "applied PiB skills; restarted=${#restarted_units[@]} deferred=${#deferred_units[@]}"
  echo "PiB skill staging apply complete (restarted=${#restarted_units[@]} deferred=${#deferred_units[@]})"
else
  logger -t pib-skill-sync "applied staged PiB agent skills (no active hermes@ profiles)"
  echo "PiB skill staging apply complete"
fi
