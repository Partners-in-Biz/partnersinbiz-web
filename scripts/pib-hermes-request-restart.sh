#!/usr/bin/env bash
# Root helper: busy-safe Hermes profile restart for the admin sidecar (user=hermes).
# Usage: pib-hermes-request-restart <profile> [reason]
# Exit codes: 0 restarted, 2 deferred (busy), 1 hard failure / invalid args.
set -euo pipefail

profile="${1:-}"
reason="${2:-admin-sidecar}"

if [[ ! "$profile" =~ ^[a-z][a-z0-9-]{0,63}$ ]]; then
  echo "invalid profile: ${profile}" >&2
  exit 1
fi

LIB="${PIB_HERMES_RESTART_LIB:-/usr/local/lib/partnersinbiz/pib-hermes-profile-restart-lib.sh}"
# shellcheck source=/dev/null
source "$LIB"

quiet_seconds=${PIB_SKILL_RESTART_QUIET_SECONDS:-2}
# Single instantaneous busy check — never wait here (HTTP request path).
soft_wait=${PIB_SIDECAR_RESTART_SOFT_WAIT_SECONDS:-0}
health_seconds=${PIB_SKILL_RESTART_HEALTH_SECONDS:-45}

# Mark reason for operators reading pending files.
pib_hermes_mark_pending_restart "$profile" "$reason" >/dev/null

set +e
pib_hermes_restart_profile_when_idle "$profile" "$quiet_seconds" "$soft_wait" "$health_seconds" 0
rc=$?
set -e
exit "$rc"
