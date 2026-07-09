#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT_DIR}/infra/hermes/admin_sidecar.py"
TARGET_HOST="${HERMES_SIDECAR_HOST:-root@hermes-api.partnersinbiz.online}"
TARGET_PATH="${HERMES_SIDECAR_PATH:-/var/lib/hermes/admin_sidecar.py}"
SERVICE="${HERMES_SIDECAR_SERVICE:-hermes-admin-sidecar.service}"

if [[ ! -f "$SOURCE" ]]; then
  echo "Missing sidecar source: $SOURCE" >&2
  exit 1
fi

python3 -m py_compile "$SOURCE"

STAMP="$(date -u +%Y%m%d%H%M%S)"
REMOTE_BACKUP="${TARGET_PATH}.bak-${STAMP}"

echo "Deploying $SOURCE to ${TARGET_HOST}:${TARGET_PATH}"
ssh "$TARGET_HOST" "if [[ -f '$TARGET_PATH' ]]; then cp '$TARGET_PATH' '$REMOTE_BACKUP'; else echo 'No existing sidecar at $TARGET_PATH; skipping backup'; fi"
scp "$SOURCE" "${TARGET_HOST}:${TARGET_PATH}"
ssh "$TARGET_HOST" "python3 -m py_compile '$TARGET_PATH' && systemctl restart '$SERVICE' && systemctl is-active '$SERVICE'"

echo "Backup: ${TARGET_HOST}:${REMOTE_BACKUP}"
