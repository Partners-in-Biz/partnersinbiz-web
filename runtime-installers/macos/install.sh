#!/bin/bash
set -euo pipefail

LABEL="com.partnersinbiz.runtime"
ROOT="$HOME/Library/Application Support/PartnersInBiz"
BIN="$ROOT/current/pib-runtime"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
API_BASE="${PIB_API_BASE:-https://partnersinbiz.online}"
METADATA_URL="${PIB_RUNTIME_METADATA_URL:-$API_BASE/runtime/macos/stable.json}"
PUBLIC_KEY="${PIB_RUNTIME_UPDATE_PUBLIC_KEY:-}"
RELEASE_MANAGER="${PIB_RELEASE_MANAGER:-$(dirname "$0")/pib-release-manager}"

usage() { echo "usage: install.sh install|pair|update|rollback|uninstall|revoke [challengeId]"; }
require_root() { [[ $EUID -ne 0 ]] || { echo "Run as the paired desktop user, not root." >&2; exit 1; }; }

# Runtime credentials (device credential, transport token and signing private key)
# are written/read by the runtime through Keychain. They never enter files,
# command arguments or logs. `security` is used only for existence/deletion;
# secret insertion uses the Security.framework implementation in pib-runtime.
credential_exists() { security find-generic-password -s "$LABEL" >/dev/null 2>&1; }
delete_credentials() { security delete-generic-password -s "$LABEL" >/dev/null 2>&1 || true; }

verify_release() {
  local metadata="$1" payload="$2"
  local unsigned_flag=""
  [[ -n "$PUBLIC_KEY" ]] || { [[ "${PIB_ALLOW_UNSIGNED_DEV:-0}" == 1 ]] || { echo "Production install refused: update signature key missing." >&2; return 1; };echo "UNSIGNED DEVELOPMENT MODE: package authenticity is not guaranteed." >&2;unsigned_flag="--allow-unsigned-dev"; }
  local key_file="$metadata.public.pem" signature_file="$metadata.sig"
  [[ -z "$PUBLIC_KEY" ]]||printf '%s\n' "$PUBLIC_KEY" > "$key_file" # public verification material, never a credential
  [[ -n "$unsigned_flag" || -f "$signature_file" ]] || { [[ "${4:-}" != offline ]] || { echo 'Stored release signature is missing.' >&2;return 1; };curl --fail --silent --show-error --proto '=https' "$METADATA_URL.sig" -o "$signature_file"; }
  [[ -x "$RELEASE_MANAGER" ]] || { echo "Signed release manager is missing." >&2; return 1; }
  local current_version="${PIB_RUNTIME_CURRENT_VERSION:-}" rollback_flag=""
  if [[ -z "$current_version" && -x "$ROOT/current/pib-runtime" && -f "$ROOT/current/manifest.json" && -f "$ROOT/current/manifest.sig" ]];then current_version="$($RELEASE_MANAGER installed-version --manifest "$ROOT/current/manifest.json" --signature "$ROOT/current/manifest.sig" --payload "$ROOT/current/pib-runtime" --public-key "$key_file" --platform macos --architecture "$(uname -m | sed 's/x86_64/x64/')" --channel stable)";fi
  [[ -n "$current_version" ]]||current_version="$(/usr/bin/plutil -extract minimumVersion raw "$metadata")"
  [[ "${3:-}" != rollback ]] || rollback_flag="--allow-downgrade"
  local verify_args=(verify --manifest "$metadata" --payload "$payload" --platform macos --architecture "$(uname -m | sed 's/x86_64/x64/')" --current-version "$current_version" --channel stable)
  [[ -z "$unsigned_flag" ]]&&verify_args+=(--signature "$signature_file" --public-key "$key_file")||verify_args+=(--allow-unsigned-dev)
  [[ -z "$rollback_flag" ]]||verify_args+=(--allow-downgrade)
  "$RELEASE_MANAGER" "${verify_args[@]}"
}

install_runtime() {
  require_root
  local stage; stage="$(mktemp -d)"; trap 'rm -rf "$stage"' RETURN
  curl --fail --silent --show-error --proto '=https' "$METADATA_URL" -o "$stage/metadata.json"
  local url; url="$(/usr/bin/plutil -extract payloadUrl raw "$stage/metadata.json")"
  curl --fail --silent --show-error --proto '=https' "$url" -o "$stage/pib-runtime"
  chmod 0755 "$stage/pib-runtime"
  verify_release "$stage/metadata.json" "$stage/pib-runtime"
  cp "$stage/metadata.json" "$stage/manifest.json"; cp "$stage/metadata.json.sig" "$stage/manifest.sig" 2>/dev/null || cp "$stage/metadata.json.sig" "$stage/manifest.sig"
  mkdir -p "$ROOT"; rm -rf "$ROOT/previous.new"; [[ ! -d "$ROOT/current" ]] || mv "$ROOT/current" "$ROOT/previous.new"
  mkdir -p "$stage/release"; cp "$stage/pib-runtime" "$stage/release/pib-runtime";cp "$RELEASE_MANAGER" "$stage/release/pib-release-manager";cp "$(dirname "$0")/pib-credential-helper" "$stage/release/pib-credential-helper";chmod 0755 "$stage/release/"*;cp "$stage/manifest.json" "$stage/release/manifest.json";[[ ! -f "$stage/manifest.sig" ]]||cp "$stage/manifest.sig" "$stage/release/manifest.sig"
  mv "$stage/release" "$ROOT/current"; rm -rf "$ROOT/previous"; [[ ! -d "$ROOT/previous.new" ]] || mv "$ROOT/previous.new" "$ROOT/previous"
  local logs="$ROOT/logs";mkdir -p "$logs";chmod 0700 "$ROOT" "$logs";[[ ! -f "$logs/runtime.log" ]]||{ for n in 4 3 2 1;do [[ ! -f "$logs/runtime.log.$n" ]]||mv "$logs/runtime.log.$n" "$logs/runtime.log.$((n+1))";done;mv "$logs/runtime.log" "$logs/runtime.log.1";};touch "$logs/runtime.log";chmod 0600 "$logs/runtime.log"
  mkdir -p "$(dirname "$PLIST")"; sed -e "s|__PIB_RUNTIME_BINARY__|$BIN|g" -e "s|__PIB_RUNTIME_LOG_DIR__|$logs|g" "$(dirname "$0")/$LABEL.plist" > "$PLIST"; chmod 0644 "$PLIST"
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"; launchctl kickstart -k "gui/$(id -u)/$LABEL"
}

pair_runtime() {
  local challengeId="${1:-}"; [[ "$challengeId" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || { echo "Invalid challengeId." >&2; exit 2; }
  [[ -x "$BIN" ]] || { echo "Install the runtime first." >&2; exit 1; }
  # pib-runtime prompts privately for the one-time code, creates its device key,
  # exchanges the challenge, stores all results in Keychain, then sends a signed
  # heartbeat with bootstrapTransport=true and starts the local Hermes bridge.
  "$BIN" pair --challenge "$challengeId" --platform macos --prompt-code --credential-store keychain
}

update_runtime() { install_runtime; }
rollback_runtime() { require_root; [[ -x "$ROOT/previous/pib-runtime" ]] || { echo 'No verified previous release.' >&2; return 1; }; verify_release "$ROOT/previous/manifest.json" "$ROOT/previous/pib-runtime" rollback offline; mv "$ROOT/current" "$ROOT/swap"; mv "$ROOT/previous" "$ROOT/current"; mv "$ROOT/swap" "$ROOT/previous"; launchctl kickstart -k "gui/$(id -u)/$LABEL"; }
revoke_runtime() { [[ -x "$BIN" ]] && "$BIN" revoke --signed-request --execution-receipt; delete_credentials; }
uninstall_runtime() { require_root; revoke_runtime; launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true; rm -f "$PLIST"; rm -rf "$ROOT"; }

case "${1:-}" in
  install) install_runtime;; pair) pair_runtime "${2:-}";; update) update_runtime;; rollback) rollback_runtime;;
  revoke) revoke_runtime;; uninstall) uninstall_runtime;; *) usage; exit 2;;
esac
