#!/bin/bash
set -euo pipefail

LABEL="com.partnersinbiz.runtime"
ROOT="/Library/PartnersInBiz"
BIN="$ROOT/bin/pib-runtime"
PLIST="/Library/LaunchDaemons/$LABEL.plist"
API_BASE="${PIB_API_BASE:-https://partnersinbiz.online}"
METADATA_URL="${PIB_RUNTIME_METADATA_URL:-$API_BASE/runtime/macos/stable.json}"
PUBLIC_KEY="${PIB_RUNTIME_UPDATE_PUBLIC_KEY:-}"

usage() { echo "usage: install.sh install|pair|update|rollback|uninstall|revoke [challengeId]"; }
require_root() { [[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }; }

# Runtime credentials (device credential, transport token and signing private key)
# are written/read by the runtime through Keychain. They never enter files,
# command arguments or logs. `security` is used only for existence/deletion;
# secret insertion uses the Security.framework implementation in pib-runtime.
credential_exists() { security find-generic-password -s "$LABEL" >/dev/null 2>&1; }
delete_credentials() { security delete-generic-password -s "$LABEL" >/dev/null 2>&1 || true; }

verify_release() {
  local metadata="$1" payload="$2"
  [[ -n "$PUBLIC_KEY" ]] || {
    [[ "${PIB_ALLOW_UNSIGNED_DEV:-0}" == 1 ]] || { echo "Production install refused: update signature key missing." >&2; return 1; }
    echo "UNSIGNED DEVELOPMENT MODE: package authenticity is not guaranteed." >&2
    return 0
  }
  local key_file="$metadata.public.pem" signature_file="$metadata.sig"
  printf '%s\n' "$PUBLIC_KEY" > "$key_file" # public verification material, never a credential
  curl --fail --silent --show-error --proto '=https' "$METADATA_URL.sig" -o "$signature_file"
  openssl dgst -sha256 -verify "$key_file" -signature "$signature_file" "$metadata" >/dev/null
  local expected actual
  expected="$(/usr/bin/plutil -extract sha256 raw "$metadata")"
  actual="$(shasum -a 256 "$payload" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || { echo "Release payload hash verification failed." >&2; return 1; }
}

install_runtime() {
  require_root
  local stage; stage="$(mktemp -d)"; trap 'rm -rf "$stage"' RETURN
  curl --fail --silent --show-error --proto '=https' "$METADATA_URL" -o "$stage/metadata.json"
  local url; url="$(/usr/bin/plutil -extract payloadUrl raw "$stage/metadata.json")"
  curl --fail --silent --show-error --proto '=https' "$url" -o "$stage/pib-runtime"
  chmod 0755 "$stage/pib-runtime"
  verify_release "$stage/metadata.json" "$stage/pib-runtime"
  if [[ -e "$BIN" ]]; then cp "$BIN" "$ROOT/pib-runtime.previous"; fi
  mkdir -p "$ROOT/bin"; cp "$stage/pib-runtime" "$BIN"
  "$BIN" enforce-minimum-version --metadata "$stage/metadata.json" # minimumVersion gate
  cp "$(dirname "$0")/$LABEL.plist" "$PLIST"; chown root:wheel "$PLIST"; chmod 0644 "$PLIST"
  launchctl bootout system "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap system "$PLIST"; launchctl kickstart -k "system/$LABEL"
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
rollback_runtime() { require_root; [[ -x "$ROOT/pib-runtime.previous" ]]; cp "$ROOT/pib-runtime.previous" "$BIN"; launchctl kickstart -k "system/$LABEL"; }
revoke_runtime() { [[ -x "$BIN" ]] && "$BIN" revoke --signed-request --execution-receipt; delete_credentials; }
uninstall_runtime() { require_root; revoke_runtime; launchctl bootout system "$PLIST" >/dev/null 2>&1 || true; rm -f "$PLIST"; rm -rf "$ROOT"; }

case "${1:-}" in
  install) install_runtime;; pair) pair_runtime "${2:-}";; update) update_runtime;; rollback) rollback_runtime;;
  revoke) revoke_runtime;; uninstall) uninstall_runtime;; *) usage; exit 2;;
esac
