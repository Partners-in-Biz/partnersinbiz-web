#!/usr/bin/env bash
# Detect Hermes skill drift between git pack, Mac Hermes mounts, and optional VPS.
#
# Exit 0 = healthy, 1 = drift found, 2 = usage/config error.
#
# Usage:
#   bash scripts/check-hermes-skills-drift.sh
#   bash scripts/check-hermes-skills-drift.sh --vps root@65.108.146.144
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK="$ROOT/packs/pib-system-skills"
POLICY="$ROOT/config/agent-skill-policy.json"
HERMES_ROOT="${HERMES_ROOT:-$HOME/.hermes}"
VPS_HOST=""

for arg in "$@"; do
  case "$arg" in
    --vps) ;;
    --vps=*) VPS_HOST="${arg#--vps=}" ;;
    --help|-h)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      if [ -z "$VPS_HOST" ] && [[ "$arg" == *@* || "$arg" == root@* ]]; then
        VPS_HOST="$arg"
      elif [ "${PREV:-}" = "--vps" ]; then
        VPS_HOST="$arg"
      fi
      ;;
  esac
  PREV="$arg"
done

die() { echo "error: $*" >&2; exit 2; }
[ -f "$PACK/manifest.json" ] || die "missing pack"
[ -f "$POLICY" ] || die "missing policy"

DRIFT=0
note() { echo "$*"; }
fail() { echo "DRIFT: $*" >&2; DRIFT=1; }

PACK_VER="$(node -e "console.log(require('$PACK/manifest.json').packVersion)")"
PACK_CAT="$(node -e "console.log(require('$PACK/manifest.json').catalogVersion)")"
POL_VER="$(node -e "console.log(require('$POLICY').version)")"
POL_CAT="$(node -e "console.log(require('$POLICY').catalogVersion)")"

note "pack=$PACK_VER catalog=$PACK_CAT"
note "policy=$POL_VER catalog=$POL_CAT"
[ "$PACK_CAT" = "$POL_CAT" ] || fail "catalogVersion mismatch pack vs policy"

# Core skills from pack must exist in pack/skills and Mac shared cache
while IFS= read -r skill; do
  [ -z "$skill" ] && continue
  [ -f "$PACK/skills/$skill/SKILL.md" ] || fail "pack missing skills/$skill/SKILL.md"
  if [ -d "$HERMES_ROOT/pib-skills/partnersinbiz" ]; then
    [ -e "$HERMES_ROOT/pib-skills/partnersinbiz/$skill" ] \
      || fail "Mac shared cache missing $skill (run install-mac-hermes-skills.sh)"
  else
    fail "Mac shared cache missing ($HERMES_ROOT/pib-skills/partnersinbiz)"
  fi
done < <(node -e "const m=require('$PACK/manifest.json'); console.log([...m.tiers.core.skills,...m.tiers.growth.skills].join('\n'))")

# Every agent must mount the all-agent baseline skills
while IFS= read -r agent; do
  [ -z "$agent" ] && continue
  for skill in system-auth daily-workflow; do
    [ -e "$HERMES_ROOT/agent-skills/$agent/partnersinbiz/$skill" ] \
      || fail "Mac agent-skills/$agent missing $skill"
  done
done < <(node -e "console.log(Object.keys(require('$POLICY').agents).join('\n'))")

# Stale Claude content trees should not be live copies
for stale in "$HOME/.claude/skills/partnersinbiz" "$HOME/.codex/skills/partnersinbiz" "$HOME/.agents/skills/partnersinbiz"; do
  if [ -d "$stale" ] && [ ! -L "$stale" ]; then
    fail "stale non-symlink tree still present: $stale (quarantine via install-mac-hermes-skills.sh --quarantine-claude)"
  fi
done

if [ -n "$VPS_HOST" ]; then
  note "checking VPS $VPS_HOST …"
  remote="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS_HOST" 'bash -s' <<'REMOTE'
set -e
DRIFT=0
fail(){ echo "DRIFT: $*"; DRIFT=1; }
[ -d /var/lib/hermes/pib-system-skills/skills ] || fail "VPS pack missing"
for skill in system-auth daily-workflow; do
  [ -e "/var/lib/hermes/pib-skills/partnersinbiz/$skill" ] || fail "VPS shared cache missing $skill"
done
for a in pip theo maya sage nora ads qa-release support data docs seo sales; do
  for skill in system-auth daily-workflow; do
    [ -e "/var/lib/hermes/agent-skills/$a/partnersinbiz/$skill" ] || fail "VPS agent $a missing $skill"
  done
done
# profiles must point only at agent-skills
for a in pip theo maya; do
  cfg=/var/lib/hermes/profiles/$a/config.yaml
  [ -f "$cfg" ] || continue
  if ! grep -q "agent-skills/$a" "$cfg"; then
    fail "VPS profile $a external_dirs not agent-skills/$a"
  fi
done
exit $DRIFT
REMOTE
)" || true
  if [ -n "$remote" ]; then
    echo "$remote"
    echo "$remote" | grep -q '^DRIFT:' && DRIFT=1 || true
  fi
fi

if [ "$DRIFT" -ne 0 ]; then
  echo
  echo "Hermes skill drift detected."
  exit 1
fi
echo
echo "ok: no Hermes skill drift detected"
exit 0
