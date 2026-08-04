#!/usr/bin/env bash
# Ensure Hermes still accepts PiB managed SuperGrok access-only OAuth tokens.
#
# After every hermes update / upstream merge, run this on Mac and VPS.
# PiB deliberately strips refresh_token from linked machines; upstream Hermes
# hard-fails without the PiB access-only patch.
#
# See: agents/partners/wiki/xai-oauth-access-only-hermes-patch-2026-08-03.md
set -euo pipefail

HERMES_AGENT_DIR="${1:-${HERMES_AGENT_DIR:-$HOME/.hermes/hermes-agent}}"
PATCH_MARKER='refresh_token is optional for managed'
# Original PiB commit; may need a newer tip if the patch was rebased.
SEED_COMMIT="${PIB_XAI_ACCESS_ONLY_COMMIT:-9cd97d43e}"

if [[ ! -d "$HERMES_AGENT_DIR/.git" ]]; then
  echo "ERROR: not a hermes-agent git checkout: $HERMES_AGENT_DIR" >&2
  exit 1
fi

cd "$HERMES_AGENT_DIR"

if rg -q "$PATCH_MARKER" hermes_cli/auth.py 2>/dev/null; then
  echo "OK: access-only xAI OAuth patch present at $(git rev-parse --short HEAD)"
  exit 0
fi

echo "WARN: access-only xAI OAuth patch missing at $(git rev-parse --short HEAD); re-applying $SEED_COMMIT"

if ! git cat-file -e "${SEED_COMMIT}^{commit}" 2>/dev/null; then
  echo "ERROR: seed commit $SEED_COMMIT not in this repo. Fetch/cherry-pick manually from pib/xai-access-only-multi-device." >&2
  exit 2
fi

# Stash only if dirty; do not discard unrelated work.
dirty=0
if [[ -n "$(git status --porcelain)" ]]; then
  dirty=1
  git stash push -u -m "ensure-xai-access-only-pre-cherry-pick-$(date +%Y%m%d%H%M%S)" >/dev/null
fi

if ! git cherry-pick --no-commit "$SEED_COMMIT"; then
  echo "ERROR: cherry-pick failed; resolve conflicts in hermes_cli/auth.py + agent/credential_pool.py" >&2
  git cherry-pick --abort 2>/dev/null || true
  [[ $dirty -eq 1 ]] && git stash pop || true
  exit 3
fi

if ! rg -q "$PATCH_MARKER" hermes_cli/auth.py; then
  echo "ERROR: cherry-pick applied but marker still missing" >&2
  git reset --hard HEAD
  [[ $dirty -eq 1 ]] && git stash pop || true
  exit 4
fi

git commit -m "$(cat <<'EOF'
fix(auth): accept managed access-only xAI OAuth for multi-device delivery

Re-apply PiB patch after hermes update dropped access-only SuperGrok support.
Linked machines receive short-lived access tokens only; refresh stays in the
Partners in Biz control plane.
EOF
)"

# Keep lineage branch pointer when present.
if git show-ref --verify --quiet refs/heads/pib/xai-access-only-multi-device; then
  git branch -f pib/xai-access-only-multi-device HEAD
fi

find hermes_cli agent -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

if [[ -x venv/bin/python ]]; then
  venv/bin/python -m pytest tests/hermes_cli/test_xai_oauth_profile_auth.py -q --tb=line || {
    echo "ERROR: access-only unit tests failed after re-apply" >&2
    exit 5
  }
fi

[[ $dirty -eq 1 ]] && git stash pop || true

echo "OK: re-applied access-only patch at $(git rev-parse --short HEAD)"
echo "Restart fleet supervisor so running gateways load the new auth module:"
echo "  Mac: launchctl kickstart -k gui/\$(id -u)/ai.hermes.local-runtime"
echo "  VPS: systemctl restart hermes@pip hermes@theo … (or all hermes@*)"
