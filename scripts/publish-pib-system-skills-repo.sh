#!/usr/bin/env bash
# Publish packs/pib-system-skills into a standalone GitHub repo.
# Safe to re-run: force-pushes only the orphan branch content for the pack tree.
#
# Usage:
#   bash scripts/publish-pib-system-skills-repo.sh [--create]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK="$ROOT/packs/pib-system-skills"
REPO_NAME="pib-system-skills"
ORG="Partners-in-Biz"
FULL="$ORG/$REPO_NAME"
CREATE=0
for arg in "$@"; do
  [ "$arg" = "--create" ] && CREATE=1
done

[ -f "$PACK/manifest.json" ] || { echo "missing pack at $PACK"; exit 1; }

if [ "$CREATE" -eq 1 ]; then
  if ! gh repo view "$FULL" >/dev/null 2>&1; then
    gh repo create "$FULL" --private --description "Versioned Partners in Biz system skills pack for Mac/VPS/client agents" --source "$PACK" --remote origin --push || true
  fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rsync -a --exclude '.git' "$PACK/" "$TMP/"
cd "$TMP"
git init -b main
git add -A
VERSION="$(node -e "console.log(require('./manifest.json').packVersion)")"
git -c user.email='agents@partnersinbiz.online' -c user.name='PiB Agents' commit -m "chore: publish pib-system-skills v${VERSION}"

if gh repo view "$FULL" >/dev/null 2>&1; then
  git remote add origin "https://github.com/${FULL}.git"
  git push -u origin main --force
  git tag -f "v${VERSION}"
  git push origin "v${VERSION}" --force
  echo "Published $FULL @ v${VERSION}"
else
  echo "Repo $FULL does not exist yet. Re-run with --create (requires gh auth)."
  echo "Local orphan commit prepared in temp; pack remains at $PACK"
fi
