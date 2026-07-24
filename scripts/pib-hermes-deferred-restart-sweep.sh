#!/usr/bin/env bash
# Sweep deferred Hermes profile restarts when long-running jobs finish.
# Safe for multi-hour runs: never force-kills a busy profile.
set -euo pipefail

LIB="${PIB_HERMES_RESTART_LIB:-/usr/local/lib/partnersinbiz/pib-hermes-profile-restart-lib.sh}"
# shellcheck source=/dev/null
source "$LIB"

PENDING_DIR="${PIB_HERMES_PENDING_DIR:-/var/lib/partnersinbiz/hermes-restart-pending}"
quiet_seconds=${PIB_SKILL_RESTART_QUIET_SECONDS:-3}
# Sweeper does a single quiet check (0s soft wait) — timer retries later.
# Override with PIB_DEFERRED_RESTART_SOFT_WAIT_SECONDS for longer waits.
soft_wait=${PIB_DEFERRED_RESTART_SOFT_WAIT_SECONDS:-0}
health_seconds=${PIB_SKILL_RESTART_HEALTH_SECONDS:-45}
gap_seconds=${PIB_SKILL_RESTART_GAP_SECONDS:-2}

if [[ ! -d "$PENDING_DIR" ]]; then
  echo "No pending Hermes restarts"
  exit 0
fi

shopt -s nullglob
pending_files=("$PENDING_DIR"/*)
if (( ${#pending_files[@]} == 0 )); then
  echo "No pending Hermes restarts"
  exit 0
fi

restarted=0
deferred=0
failed=0
for path in "${pending_files[@]}"; do
  [[ -f "$path" ]] || continue
  profile=$(basename "$path")
  [[ "$profile" =~ ^[a-z][a-z0-9-]{0,63}$ ]] || {
    echo "skip invalid pending name: $profile" >&2
    continue
  }
  set +e
  pib_hermes_restart_profile_when_idle "$profile" "$quiet_seconds" "$soft_wait" "$health_seconds" "$gap_seconds"
  rc=$?
  set -e
  case "$rc" in
    0) restarted=$((restarted + 1)) ;;
    2) deferred=$((deferred + 1)) ;;
    *) failed=$((failed + 1)) ;;
  esac
done

logger -t pib-hermes-deferred-restart \
  "sweep restarted=${restarted} deferred=${deferred} failed=${failed}"
echo "deferred restart sweep: restarted=${restarted} deferred=${deferred} failed=${failed}"
# Never fail the timer on deferred-busy; only hard failures.
if (( failed > 0 )); then
  exit 1
fi
exit 0
