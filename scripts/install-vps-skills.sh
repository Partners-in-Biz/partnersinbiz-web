#!/usr/bin/env bash
# Install the PiB platform-API skills into the shared VPS skill cache and apply
# the hard per-agent skill allowlist.
#
# Prefers the versioned system skills pack at /var/lib/hermes/pib-system-skills
# when present (Partners-in-Biz/pib-system-skills). Falls back to the
# partnersinbiz-web/.claude/skills tree for skills not in the pack.
#
# The shared cache at /var/lib/hermes/pib-skills/partnersinbiz is populated as
# symlinks. Per-agent runtime directories are then generated under
# /var/lib/hermes/agent-skills/<agent>.
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
# Env:
#   PIB_SYSTEM_SKILLS_VERSION  pin tag/branch (default: v0.1.2)
set -euo pipefail

ROOT="/var/lib/hermes"
WEB_SRC="/var/lib/hermes/partnersinbiz-web/.claude/skills"
PACK_ROOT="/var/lib/hermes/pib-system-skills"
PACK_SRC="$PACK_ROOT/skills"
SHARED="/var/lib/hermes/pib-skills/partnersinbiz"
POLICY_SCRIPT="/var/lib/hermes/partnersinbiz-web/scripts/apply-agent-skill-policy.mjs"
POLICY_JSON="/var/lib/hermes/partnersinbiz-web/config/agent-skill-policy.json"
PIN="${PIB_SYSTEM_SKILLS_VERSION:-v0.1.2}"

if [ ! -f "$POLICY_JSON" ]; then
  echo "FATAL: skill policy missing at $POLICY_JSON" >&2
  exit 1
fi

# Ensure versioned pack is available (best-effort; non-fatal if clone fails)
if command -v git >/dev/null 2>&1; then
  if [ ! -d "$PACK_ROOT/.git" ]; then
    echo "Cloning pib-system-skills@$PIN …"
    git clone --depth 1 --branch "$PIN" \
      https://github.com/Partners-in-Biz/pib-system-skills.git "$PACK_ROOT" \
      || git clone --depth 1 https://github.com/Partners-in-Biz/pib-system-skills.git "$PACK_ROOT" || true
  else
    git -C "$PACK_ROOT" fetch --tags --force origin 2>/dev/null || true
    git -C "$PACK_ROOT" checkout -q "$PIN" 2>/dev/null \
      || git -C "$PACK_ROOT" checkout -q main 2>/dev/null || true
    git -C "$PACK_ROOT" pull --ff-only 2>/dev/null || true
  fi
fi

if [ -d "$PACK_SRC" ]; then
  echo "Using system skills pack at $PACK_ROOT ($(git -C "$PACK_ROOT" describe --tags --always 2>/dev/null || echo unknown))"
  SRC_PRIMARY="$PACK_SRC"
else
  echo "WARN: pack missing; using web skills only at $WEB_SRC"
  SRC_PRIMARY="$WEB_SRC"
fi

PLATFORM_SKILLS=()
while IFS= read -r skill; do
  [ -n "$skill" ] && PLATFORM_SKILLS+=("$skill")
done < <(node -e "const p=require('$POLICY_JSON'); console.log(Object.entries(p.skillCatalog).filter(([,v]) => v.syncTarget === 'vps').map(([k]) => k).sort().join('\n'))")

if [ ! -d "$SRC_PRIMARY" ] && [ ! -d "$WEB_SRC" ]; then
  echo "FATAL: no skill source directories found" >&2
  exit 1
fi

mkdir -p "$SHARED"

for skill in "${PLATFORM_SKILLS[@]}"; do
  source_path=""
  if [ -d "$SRC_PRIMARY/$skill" ]; then
    source_path="$SRC_PRIMARY/$skill"
  elif [ -d "$WEB_SRC/$skill" ]; then
    source_path="$WEB_SRC/$skill"
  fi

  dest_path="$SHARED/$skill"

  if [ -z "$source_path" ]; then
    echo "skip $skill — source missing"
    continue
  fi

  rm -rf "$dest_path"
  mkdir -p "$(dirname "$dest_path")"
  ln -s "$source_path" "$dest_path"
  echo "cached $skill <- $source_path"
done

node "$POLICY_SCRIPT" --root "$ROOT" --apply "$@"

echo
echo "Done. Restart the touched hermes@<agent> services so the new external_dirs are loaded."
