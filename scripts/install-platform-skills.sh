#!/usr/bin/env bash
# Install the PiB platform-API skills into ~/Cowork/.claude/skills/ as
# symlinks, so they're discoverable from any Cowork project (Claude Code
# walks .claude/skills upward from cwd).
#
# Idempotent — safe to re-run. Symlinks always point back to the canonical
# location inside the partnersinbiz-web repo so edits are git-versioned.
#
# Prefer the versioned system skills pack when present:
#   packs/pib-system-skills (pib-system-skills@semver)
#
# Usage:
#   bash partnersinbiz-web/scripts/install-platform-skills.sh
set -euo pipefail

ROOT="/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web"
SRC="$ROOT/.claude/skills"
DEST="/Users/peetstander/Cowork/.claude/skills"
PACK="$ROOT/packs/pib-system-skills"

POLICY_JSON="$ROOT/config/agent-skill-policy.json"

# 1) Install versioned system pack (core + growth) into DEST + DEST/partnersinbiz
if [ -x "$PACK/bin/pib-skills" ]; then
  echo "Installing pib-system-skills pack…"
  PIB_SKILLS_DEST="$DEST" bash "$PACK/bin/pib-skills" install all
  echo
fi


# Only top-level PiB platform/runtime skills are exposed Cowork-wide. Nested
# marketing and software-development skills are specialist runtime skills and
# are mounted per agent on the VPS from the policy catalog.
PLATFORM_SKILLS=()
while IFS= read -r skill; do
  [ -n "$skill" ] && PLATFORM_SKILLS+=("$skill")
done < <(node -e "const p=require('$POLICY_JSON'); console.log(p.repoPibSkills.join('\n'))")

mkdir -p "$DEST"

for skill in "${PLATFORM_SKILLS[@]}"; do
  source_path="$SRC/$skill"
  dest_path="$DEST/$skill"

  if [ ! -d "$source_path" ]; then
    echo "skip $skill — source missing at $source_path"
    continue
  fi

  if [ -L "$dest_path" ]; then
    # Existing symlink — refresh in case the target moved
    rm "$dest_path"
    ln -s "$source_path" "$dest_path"
    echo "refreshed $skill"
  elif [ -e "$dest_path" ]; then
    echo "skip $skill — non-symlink already exists at $dest_path (not touching it)"
  else
    ln -s "$source_path" "$dest_path"
    echo "linked $skill"
  fi
done

echo
echo "Done. From any Cowork project these skills now activate via Claude Code skill discovery."
