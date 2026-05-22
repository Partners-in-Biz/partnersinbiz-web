#!/usr/bin/env bash
# Install the PiB platform-API skills into the shared VPS skill cache and apply
# the hard per-agent skill allowlist.
#
# The shared cache at /var/lib/hermes/pib-skills/partnersinbiz is populated as
# symlinks back to the cloned partnersinbiz-web repo. Per-agent runtime
# directories are then generated under /var/lib/hermes/agent-skills/<agent>.
#
# Idempotent — safe to re-run on every git pull.
#
# Usage:
#   sudo -u hermes bash /var/lib/hermes/partnersinbiz-web/scripts/install-vps-skills.sh
#
# Example:
#   sudo -u hermes bash /var/lib/hermes/partnersinbiz-web/scripts/install-vps-skills.sh --quarantine-profile-skills
#
# Optional trailing agent IDs limit the policy apply to those agents.
set -euo pipefail

ROOT="/var/lib/hermes"
SRC="/var/lib/hermes/partnersinbiz-web/.claude/skills"
SHARED="/var/lib/hermes/pib-skills/partnersinbiz"
POLICY_SCRIPT="/var/lib/hermes/partnersinbiz-web/scripts/apply-agent-skill-policy.mjs"
POLICY_JSON="/var/lib/hermes/partnersinbiz-web/config/agent-skill-policy.json"

if [ ! -f "$POLICY_JSON" ]; then
  echo "FATAL: skill policy missing at $POLICY_JSON" >&2
  exit 1
fi

mapfile -t PLATFORM_SKILLS < <(node -e "const p=require('$POLICY_JSON'); console.log(Object.entries(p.skillCatalog).filter(([,v]) => v.syncTarget === 'vps').map(([k]) => k).sort().join('\n'))")

if [ ! -d "$SRC" ]; then
  echo "FATAL: source skills dir missing at $SRC" >&2
  echo "Have you cloned partnersinbiz-web to /var/lib/hermes/partnersinbiz-web?" >&2
  exit 1
fi

mkdir -p "$SHARED"

for skill in "${PLATFORM_SKILLS[@]}"; do
  source_path="$SRC/$skill"
  dest_path="$SHARED/$skill"

  if [ ! -d "$source_path" ]; then
    echo "skip $skill — source missing at $source_path"
    continue
  fi

  rm -rf "$dest_path"
  mkdir -p "$(dirname "$dest_path")"
  ln -s "$source_path" "$dest_path"
  echo "cached $skill"
done

node "$POLICY_SCRIPT" --root "$ROOT" --apply "$@"

echo
echo "Done. Restart the touched hermes@<agent> services so the new external_dirs are loaded."
