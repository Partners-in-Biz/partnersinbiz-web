#!/usr/bin/env bash
# Install PiB system skills into the local Hermes tree (Mac).
#
# Hermes is the runtime home for specialist agents — not ~/.claude/skills.
# This mirrors the VPS installer shape:
#   ~/.hermes/pib-system-skills     (pack pin / symlink to repo pack)
#   ~/.hermes/pib-skills/partnersinbiz  (shared cache symlinks)
#   ~/.hermes/agent-skills/<agentId>    (policy-filtered mounts)
#   ~/.hermes/profiles/<agentId>/config.yaml  skills.external_dirs
#
# Claude Code paths are optional compatibility only (--claude-compat).
#
# Usage:
#   bash partnersinbiz-web/scripts/install-mac-hermes-skills.sh
#   bash partnersinbiz-web/scripts/install-mac-hermes-skills.sh --claude-compat
#   bash partnersinbiz-web/scripts/install-mac-hermes-skills.sh --quarantine-claude
set -euo pipefail

ROOT_WEB="/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web"
HERMES_ROOT="${HERMES_ROOT:-$HOME/.hermes}"
PACK_REPO="$ROOT_WEB/packs/pib-system-skills"
PACK_LINK="$HERMES_ROOT/pib-system-skills"
WEB_SRC="$ROOT_WEB/.claude/skills"
SHARED="$HERMES_ROOT/pib-skills/partnersinbiz"
POLICY_JSON="$ROOT_WEB/config/agent-skill-policy.json"
POLICY_SCRIPT="$ROOT_WEB/scripts/apply-agent-skill-policy.mjs"

CLAUDE_COMPAT=0
QUARANTINE_CLAUDE=0
for arg in "$@"; do
  case "$arg" in
    --claude-compat) CLAUDE_COMPAT=1 ;;
    --quarantine-claude) QUARANTINE_CLAUDE=1 ;;
    --help|-h)
      sed -n '2,20p' "$0"
      exit 0
      ;;
  esac
done

if [ ! -f "$POLICY_JSON" ]; then
  echo "FATAL: skill policy missing at $POLICY_JSON" >&2
  exit 1
fi

mkdir -p "$HERMES_ROOT" "$SHARED"

# Point Hermes at the repo pack (editable, git-versioned). Prefer link over clone
# so Mac agents always see the same content as the working tree.
if [ -d "$PACK_REPO/skills" ]; then
  rm -rf "$PACK_LINK"
  ln -s "$PACK_REPO" "$PACK_LINK"
  echo "linked pack -> $PACK_LINK"
else
  echo "FATAL: pack missing at $PACK_REPO" >&2
  exit 1
fi

PACK_SRC="$PACK_LINK/skills"
PLATFORM_SKILLS=()
while IFS= read -r skill; do
  [ -n "$skill" ] && PLATFORM_SKILLS+=("$skill")
done < <(node -e "const p=require('$POLICY_JSON'); console.log(Object.entries(p.skillCatalog).filter(([,v]) => v.syncTarget === 'vps').map(([k]) => k).sort().join('\n'))")

for skill in "${PLATFORM_SKILLS[@]}"; do
  source_path=""
  if [ -d "$PACK_SRC/$skill" ]; then
    source_path="$PACK_SRC/$skill"
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

# Apply hard allowlist into ~/.hermes/agent-skills/<agent> and rewrite profile external_dirs
node "$POLICY_SCRIPT" --root "$HERMES_ROOT" --apply --allow-missing-global

if [ "$QUARANTINE_CLAUDE" -eq 1 ]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  for stale in \
    "$HOME/.claude/skills/partnersinbiz" \
    "$HOME/.codex/skills/partnersinbiz" \
    "$HOME/.agents/skills/partnersinbiz"
  do
    if [ -e "$stale" ] && [ ! -L "$stale" ]; then
      dest="${stale}.quarantine-${stamp}"
      mv "$stale" "$dest"
      echo "quarantined $stale -> $dest"
    elif [ -L "$stale" ]; then
      rm -f "$stale"
      echo "removed stale symlink $stale"
    fi
  done
fi

if [ "$CLAUDE_COMPAT" -eq 1 ]; then
  # Thin discovery bridge only — points at Hermes shared cache, not a second copy.
  for dest_root in "$HOME/.claude/skills" "/Users/peetstander/Cowork/.claude/skills"; do
    mkdir -p "$dest_root"
    compat="$dest_root/partnersinbiz"
    rm -rf "$compat"
    ln -s "$SHARED" "$compat"
    echo "claude-compat $compat -> $SHARED"
  done
fi

echo
echo "Done. Hermes specialists load skills from $HERMES_ROOT/agent-skills/<agentId>."
echo "Restart local Hermes profiles if they are already running."
