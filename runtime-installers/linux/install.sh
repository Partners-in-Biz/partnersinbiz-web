#!/bin/bash
set -euo pipefail

INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PIB_LINUX_ROOT:-/opt/partnersinbiz}"
STATE_ROOT="${PIB_LINUX_STATE_ROOT:-/var/lib/partnersinbiz}"
UNIT_PATH="${PIB_LINUX_UNIT_PATH:-/etc/systemd/system/pib-runtime.service}"
RUNTIME_ENV_PATH="${PIB_RUNTIME_ENV_PATH:-/etc/partnersinbiz/runtime.env}"
BIN="$ROOT/current/pib-runtime"
API_BASE="${PIB_API_BASE:-https://partnersinbiz.online}"
RELEASE_BASE="${PIB_RUNTIME_RELEASE_BASE:-https://github.com/Partners-in-Biz/partnersinbiz-web/releases/latest/download}"
HERMES_HOME_PATH="${PIB_HERMES_HOME:-}"
ARCH="$(uname -m)"
case "$ARCH" in x86_64|amd64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; *) echo "Unsupported Linux architecture: $ARCH" >&2;exit 1;; esac
METADATA_URL="${PIB_RUNTIME_METADATA_URL:-$RELEASE_BASE/partnersinbiz-runtime-linux-$ARCH-stable.json}"
PUBLIC_KEY="${PIB_RUNTIME_UPDATE_PUBLIC_KEY:-}"
RELEASE_MANAGER="${PIB_RELEASE_MANAGER:-$INSTALLER_DIR/pib-release-manager}"
[[ -n "$PUBLIC_KEY" || ! -f "$INSTALLER_DIR/release-public.pem" ]] || PUBLIC_KEY="$(cat "$INSTALLER_DIR/release-public.pem")"
SYSTEMCTL="${PIB_SYSTEMCTL:-systemctl}"
CURL="${PIB_CURL:-curl}"
PYTHON="${PIB_PYTHON3:-python3}"
SERVICE="pib-runtime.service"
RUNTIME_CREDENTIAL_HELPER="$ROOT/current/pib-credential-helper"
RUNTIME_FILE_HELPER="$ROOT/current/pib-file-helper"

usage() {
  echo 'usage: install.sh install|update|rollback|pair CHALLENGE_ID|map MAPPING_ID ABSOLUTE_FOLDER|unmap MAPPING_ID|status|revoke|uninstall [--force-local]'
}
fail() { echo "$1" >&2; return "${2:-1}"; }
run_runtime() {
  PIB_RUNTIME_STATE_DIR="$STATE_ROOT" \
  PIB_CREDENTIAL_HELPER="$RUNTIME_CREDENTIAL_HELPER" \
  PIB_FILE_HELPER="$RUNTIME_FILE_HELPER" \
  PIB_API_BASE="$API_BASE" \
  PIB_HERMES_HOME="$HERMES_HOME_PATH" \
  PIB_SYNC_PROTOCOL_VERSION=1 \
    "$BIN" "$@"
}
write_runtime_environment() {
  local name="$1" value="$2" escaped
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || {
    fail "Runtime environment value contains a line break: $name"
    return 1
  }
  escaped="${value//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  printf '%s="%s"\n' "$name" "$escaped"
}
require_root() {
  [[ $EUID -eq 0 || ("${PIB_INSTALLER_LIBRARY:-0}" == 1 && "${PIB_LINUX_INSTALLER_TESTING:-0}" == 1) ]] || { fail 'Run the Linux VPS installer as root.'; exit 1; }
}
assert_managed_paths() {
  local candidate
  for candidate in "$ROOT" "$STATE_ROOT" "$UNIT_PATH" "$RUNTIME_ENV_PATH";do
    [[ ! -L "$candidate" ]] || { fail "Managed path symlink refused: $candidate";return 1; }
  done
}
require_host() {
  require_root
  assert_managed_paths || exit 1
  [[ "$(uname -s)" == Linux || "${PIB_LINUX_INSTALLER_TESTING:-0}" == 1 ]] || { fail 'This installer requires Linux.'; exit 1; }
  command -v "$CURL" >/dev/null || { fail 'curl is required.'; exit 1; }
  command -v "$PYTHON" >/dev/null || { fail 'Python 3 is required.'; exit 1; }
  command -v systemd-creds >/dev/null || { fail 'systemd-creds is required (systemd 250 or newer).'; exit 1; }
  local version
  version="$(systemd-creds --version | head -n 1 | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
  [[ "$version" =~ ^[0-9]+$ && "$version" -ge 250 ]] || { fail 'systemd 250 or newer is required for encrypted credentials.'; exit 1; }
}
json_field() {
  "$PYTHON" - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1], "rb") as source:
    value = json.load(source).get(sys.argv[2])
if not isinstance(value, str) or not value:
    raise SystemExit("release metadata field is missing")
print(value)
PY
}
require_https_download_url() {
  "$PYTHON" - "$1" "$METADATA_URL" "${PIB_RUNTIME_DOWNLOAD_HOSTS:-partnersinbiz.online,storage.googleapis.com,github.com,objects.githubusercontent.com}" <<'PY'
import sys
from urllib.parse import urlparse
candidate, metadata, configured = sys.argv[1:]
parsed, metadata_parsed = urlparse(candidate), urlparse(metadata)
allowed = {value.strip().lower() for value in configured.split(",") if value.strip()}
if metadata_parsed.hostname:
    allowed.add(metadata_parsed.hostname.lower())
if parsed.scheme != "https" or not parsed.hostname or parsed.hostname.lower() not in allowed or parsed.username or parsed.password:
    raise SystemExit("release download URL is not approved")
PY
}
download() {
  require_https_download_url "$1"
  "$CURL" --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 "$1" -o "$2"
}
installed_version() {
  local release="$1" manager manifest args
  manager="$release/pib-release-manager"
  manifest="$release/manifest.json"
  [[ -x "$manager" && -f "$manifest" ]] || return 1
  args=(installed-version --manifest "$manifest" --payload "$release/pib-runtime" --platform linux --architecture "$ARCH" --channel stable)
  if [[ -f "$release/.unsigned-dev" ]]; then
    [[ "${PIB_ALLOW_UNSIGNED_DEV:-0}" == 1 ]] || return 1
    args+=(--allow-unsigned-dev)
  else
    [[ -f "$release/manifest.sig" && -n "$PUBLIC_KEY" ]] || return 1
    local key="$release/release-public.pem";printf '%s\n' "$PUBLIC_KEY" > "$key";chmod 0600 "$key"
    args+=(--signature "$release/manifest.sig" --public-key "$key")
  fi
  "$manager" "${args[@]}"
}
verify_release() {
  local metadata="$1" payload="$2" mode="${3:-signed}" source="${4:-online}"
  local artifact_dir unsigned_flag='' key_file signature_file current_version rollback_flag=''
  artifact_dir="$(dirname "$metadata")"; key_file="$artifact_dir/release-public.pem"; signature_file="$artifact_dir/manifest.sig"
  if [[ -f "$artifact_dir/.unsigned-dev" || -z "$PUBLIC_KEY" ]]; then
    [[ "${PIB_ALLOW_UNSIGNED_DEV:-0}" == 1 ]] || { fail 'Production refused an unsigned development release.'; return 1; }
    echo 'UNSIGNED DEVELOPMENT MODE: package authenticity is not guaranteed.' >&2
    unsigned_flag='--allow-unsigned-dev'
  else
    printf '%s\n' "$PUBLIC_KEY" > "$key_file";chmod 0600 "$key_file"
    if [[ ! -f "$signature_file" ]]; then
      [[ "$source" != offline ]] || { fail 'Stored release signature is missing.'; return 1; }
      download "$METADATA_URL.sig" "$signature_file"
    fi
  fi
  [[ -x "$RELEASE_MANAGER" ]] || { fail 'Signed release manager is missing.'; return 1; }
  current_version="${PIB_RUNTIME_CURRENT_VERSION:-}"
  if [[ -z "$current_version" && -x "$ROOT/current/pib-runtime" ]]; then current_version="$(installed_version "$ROOT/current")";fi
  [[ -n "$current_version" ]] || current_version="$(json_field "$metadata" minimumVersion)"
  [[ "$mode" != rollback ]] || rollback_flag='--allow-downgrade'
  local args=(verify --manifest "$metadata" --payload "$payload" --platform linux --architecture "$ARCH" --current-version "$current_version" --channel stable)
  [[ -z "$unsigned_flag" ]] && args+=(--signature "$signature_file" --public-key "$key_file") || args+=(--allow-unsigned-dev)
  [[ -z "$rollback_flag" ]] || args+=(--allow-downgrade)
  "$RELEASE_MANAGER" "${args[@]}"
}
activate_verified_release() {
  local release="$1" incoming="$ROOT/.current.$$.new" old="$ROOT/.previous.$$.new"
  [[ ! -L "$ROOT" ]] || { fail 'Runtime root symlink refused.';return 1; }
  [[ -x "$release/pib-runtime" && -x "$release/pib-release-manager" && -x "$release/pib-credential-helper" && -x "$release/pib-file-helper" && -f "$release/manifest.json" ]] || { fail 'Verified release is incomplete.'; return 1; }
  install -d -m 0755 "$ROOT"
  rm -rf -- "$incoming" "$old"
  mkdir -m 0755 "$incoming"
  cp -a "$release/." "$incoming/"
  chmod 0755 "$incoming"/pib-runtime "$incoming"/pib-release-manager "$incoming"/pib-credential-helper "$incoming"/pib-file-helper
  if [[ -d "$ROOT/current" ]]; then mv "$ROOT/current" "$old";fi
  if ! mv "$incoming" "$ROOT/current"; then [[ ! -d "$old" ]] || mv "$old" "$ROOT/current";return 1;fi
  rm -rf "$ROOT/previous"
  [[ ! -d "$old" ]] || mv "$old" "$ROOT/previous"
}
swap_verified_releases() {
  [[ -x "$ROOT/previous/pib-runtime" ]] || { fail 'No verified previous release.'; return 1; }
  local swap="$ROOT/.rollback.$$.swap"
  rm -rf "$swap"
  mv "$ROOT/current" "$swap"
  if ! mv "$ROOT/previous" "$ROOT/current"; then mv "$swap" "$ROOT/current";return 1;fi
  mv "$swap" "$ROOT/previous"
}
install_systemd_assets() {
  local version temp hermes_home="$HERMES_HOME_PATH" chrome_path="${PIB_CHROME_PATH:-}"
  version="$(json_field "$ROOT/current/manifest.json" version)"
  if [[ -z "$hermes_home" && -f "$RUNTIME_ENV_PATH" ]]; then
    hermes_home="$($PYTHON - "$RUNTIME_ENV_PATH" <<'PY'
import json, sys
for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith('PIB_HERMES_HOME='):
        try:
            value = json.loads(line.split('=', 1)[1].strip())
        except (ValueError, json.JSONDecodeError):
            value = ''
        if isinstance(value, str):
            print(value)
        break
PY
)"
  fi
  if [[ -z "$chrome_path" && -f "$RUNTIME_ENV_PATH" ]]; then
    chrome_path="$($PYTHON - "$RUNTIME_ENV_PATH" <<'PY'
import json, sys
for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith('PIB_CHROME_PATH='):
        try:
            value = json.loads(line.split('=', 1)[1].strip())
        except (ValueError, json.JSONDecodeError):
            value = ''
        if isinstance(value, str):
            print(value)
        break
PY
)"
  fi
  install -d -m 0755 "$(dirname "$UNIT_PATH")" "$(dirname "$RUNTIME_ENV_PATH")"
  install -m 0644 "$INSTALLER_DIR/pib-runtime.service" "$UNIT_PATH"
  temp="$RUNTIME_ENV_PATH.$$.tmp"
  umask 077
  {
    write_runtime_environment PIB_RUNTIME_VERSION "$version"
    write_runtime_environment PIB_SYNC_PROTOCOL_VERSION 1
    write_runtime_environment PIB_RUNTIME_STATE_DIR "$STATE_ROOT"
    write_runtime_environment PIB_CREDENTIAL_HELPER "$RUNTIME_CREDENTIAL_HELPER"
    write_runtime_environment PIB_FILE_HELPER "$RUNTIME_FILE_HELPER"
    write_runtime_environment PIB_API_BASE "$API_BASE"
    [[ -z "$hermes_home" ]] || write_runtime_environment PIB_HERMES_HOME "$hermes_home"
    [[ -z "$chrome_path" ]] || write_runtime_environment PIB_CHROME_PATH "$chrome_path"
  } > "$temp"
  chmod 0600 "$temp"
  mv -f "$temp" "$RUNTIME_ENV_PATH"
  "$SYSTEMCTL" daemon-reload
  "$SYSTEMCTL" enable "$SERVICE"
}
stage_downloaded_release() {
  local stage="$1" metadata="$stage/metadata.json" payload="$stage/pib-runtime" payload_url release="$stage/release"
  download "$METADATA_URL" "$metadata"
  payload_url="$(json_field "$metadata" payloadUrl)"
  download "$payload_url" "$payload"
  chmod 0755 "$payload"
  verify_release "$metadata" "$payload"
  mkdir -m 0755 "$release"
  install -m 0755 "$payload" "$release/pib-runtime"
  install -m 0755 "$RELEASE_MANAGER" "$release/pib-release-manager"
  install -m 0755 "$INSTALLER_DIR/pib-credential-helper" "$release/pib-credential-helper"
  install -m 0755 "$INSTALLER_DIR/pib-file-helper" "$release/pib-file-helper"
  install -m 0755 "$INSTALLER_DIR/install.sh" "$release/install.sh"
  install -m 0644 "$INSTALLER_DIR/pib-runtime.service" "$release/pib-runtime.service"
  install -m 0600 "$metadata" "$release/manifest.json"
  if [[ -n "$PUBLIC_KEY" ]]; then
    install -m 0600 "$stage/manifest.sig" "$release/manifest.sig"
    install -m 0600 "$stage/release-public.pem" "$release/release-public.pem"
  else
    touch "$release/.unsigned-dev"
  fi
}
install_runtime() {
  require_host
  local stage;stage="$(mktemp -d)"
  # Expand the path while the local exists; RETURN runs after locals unwind
  # under some Bash versions and `set -u` must not turn successful updates
  # into a false failure.
  trap 'rm -rf -- "'"$stage"'"' RETURN
  stage_downloaded_release "$stage"
  "$SYSTEMCTL" stop "$SERVICE" >/dev/null 2>&1 || true
  activate_verified_release "$stage/release"
  install -d -m 0700 "$STATE_ROOT"
  install_systemd_assets
  "$SYSTEMCTL" restart "$SERVICE"
}
update_runtime() { install_runtime; }
rollback_runtime() {
  require_host
  "$SYSTEMCTL" stop "$SERVICE" >/dev/null 2>&1 || true
  verify_release "$ROOT/previous/manifest.json" "$ROOT/previous/pib-runtime" rollback offline
  swap_verified_releases
  install_systemd_assets
  "$SYSTEMCTL" restart "$SERVICE"
}
pair_runtime() {
  require_host
  local challenge="${1:-}";shift || true
  [[ "$challenge" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || { fail 'Invalid challengeId.';return 2; }
  [[ -x "$BIN" ]] || { fail 'Install the runtime first.';return 1; }
  run_runtime pair --challenge "$challenge" --platform linux "$@"
  "$SYSTEMCTL" restart "$SERVICE"
}
map_runtime() {
  require_host
  [[ "${1:-}" =~ ^[A-Za-z0-9_-]{1,128}$ && "${2:-}" == /* ]] || { fail 'Map requires a mapping ID and absolute folder.';return 2; }
  run_runtime map --mapping "$1" --folder "$2"
}
unmap_runtime() {
  require_host
  [[ "${1:-}" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || { fail 'Unmap requires a mapping ID.';return 2; }
  run_runtime unmap --mapping "$1"
}
status_runtime() { require_host;run_runtime status; }
runtime_is_unpaired() {
  local value
  value="$(run_runtime status 2>/dev/null)" || return 1
  printf '%s' "$value" | "$PYTHON" -c 'import json,sys; value=json.load(sys.stdin);raise SystemExit(0 if value.get("paired") is False else 1)' 2>/dev/null
}
revoke_runtime() {
  require_host
  [[ -x "$BIN" ]] || return 0
  if runtime_is_unpaired;then return 0;fi
  if ! run_runtime revoke; then "$SYSTEMCTL" restart "$SERVICE" >/dev/null 2>&1 || true;return 1;fi
}
uninstall_runtime() {
  require_host
  local force="${1:-}" pending=0
  if ! revoke_runtime; then
    pending=1
    if [[ "$force" != --force-local ]]; then fail 'Remote revoke pending. Runtime and encrypted identity retained in revoke-only recovery mode.';return 1;fi
    echo 'WARNING: FORCE LOCAL removal requires revoking this VPS in the PiB portal.' >&2
    "$ROOT/current/pib-credential-helper" clear || true
  fi
  "$SYSTEMCTL" stop "$SERVICE" >/dev/null 2>&1 || true
  "$SYSTEMCTL" disable "$SERVICE" >/dev/null 2>&1 || true
  rm -f "$UNIT_PATH" "$RUNTIME_ENV_PATH"
  rm -rf "$ROOT"
  if [[ "$pending" == 0 ]]; then rm -rf "$STATE_ROOT";elif [[ -d "$STATE_ROOT" ]];then find "$STATE_ROOT" -mindepth 1 ! -name revocation-pending.json -exec rm -rf -- {} +;fi
  "$SYSTEMCTL" daemon-reload
}

if [[ "${PIB_INSTALLER_LIBRARY:-0}" != 1 ]]; then
  case "${1:-}" in
    install) install_runtime;; update) update_runtime;; rollback) rollback_runtime;; pair) pair_runtime "${2:-}" "${@:3}";;
    map) map_runtime "${2:-}" "${3:-}";; unmap) unmap_runtime "${2:-}";; status) status_runtime;;
    revoke) revoke_runtime;; uninstall) uninstall_runtime "${2:-}";; *) usage;exit 2;;
  esac
fi
