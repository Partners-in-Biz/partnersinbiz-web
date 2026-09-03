#!/bin/bash
set -euo pipefail

LABEL="com.partnersinbiz.runtime"
ROOT="$HOME/Library/Application Support/PartnersInBiz"
BIN="$ROOT/current/pib-runtime"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
API_BASE="${PIB_API_BASE:-https://partnersinbiz.online}"
RELEASE_BASE="${PIB_RUNTIME_RELEASE_BASE:-https://github.com/Partners-in-Biz/partnersinbiz-web/releases/latest/download}"
ARCH="$(uname -m | sed 's/x86_64/x64/')"
METADATA_URL="${PIB_RUNTIME_METADATA_URL:-$RELEASE_BASE/partnersinbiz-runtime-macos-$ARCH-stable.json}"
PUBLIC_KEY="${PIB_RUNTIME_UPDATE_PUBLIC_KEY:-}"
RELEASE_MANAGER="${PIB_RELEASE_MANAGER:-$(dirname "$0")/pib-release-manager}"
[[ -n "$PUBLIC_KEY" || ! -f "$(dirname "$0")/release-public.pem" ]] || PUBLIC_KEY="$(cat "$(dirname "$0")/release-public.pem")"

usage() { echo "usage: install.sh install|pair|update|rollback|uninstall|revoke [challengeId|--force-local]"; }
require_root() { [[ $EUID -ne 0 ]] || { echo "Run as the paired desktop user, not root." >&2; exit 1; }; }

# Runtime credentials (device credential and signing private key)
# are written/read by the runtime through Keychain. They never enter files,
# command arguments or logs. `security` is used only for existence/deletion;
# secret insertion uses the Security.framework implementation in pib-runtime.
credential_exists() { security find-generic-password -s "$LABEL" >/dev/null 2>&1; }
delete_credentials() { security delete-generic-password -s "$LABEL" >/dev/null 2>&1 || true; }

verify_release() {
  local metadata="$1" payload="$2"
  local unsigned_flag="" artifact_dir;artifact_dir="$(dirname "$metadata")"
  if [[ -f "$artifact_dir/.unsigned-dev" || -z "$PUBLIC_KEY" ]];then [[ "${PIB_ALLOW_UNSIGNED_DEV:-0}" == 1 ]]||{ echo 'Production refused an unsigned development release.' >&2;return 1;};echo "UNSIGNED DEVELOPMENT MODE: package authenticity is not guaranteed." >&2;unsigned_flag="--allow-unsigned-dev";fi
  local key_file="$artifact_dir/release-public.pem" signature_file="$artifact_dir/manifest.sig"
  [[ -z "$PUBLIC_KEY" ]]||printf '%s\n' "$PUBLIC_KEY" > "$key_file" # public verification material, never a credential
  [[ -n "$unsigned_flag" || -f "$signature_file" ]] || { [[ "${4:-}" != offline ]] || { echo 'Stored release signature is missing.' >&2;return 1; };curl -fsSL --proto '=https' "$METADATA_URL.sig" -o "$signature_file"; }
  [[ -x "$RELEASE_MANAGER" ]] || { echo "Signed release manager is missing." >&2; return 1; }
  local current_version="${PIB_RUNTIME_CURRENT_VERSION:-}" rollback_flag=""
  if [[ -z "$current_version" && -x "$ROOT/current/pib-runtime" ]];then
    if [[ -f "$ROOT/current/.unsigned-dev" ]];then [[ "${PIB_ALLOW_UNSIGNED_DEV:-0}" == 1 ]]||{ echo 'Production refused an installed unsigned development release.' >&2;return 1;};current_version="$("$RELEASE_MANAGER" installed-version --manifest "$ROOT/current/manifest.json" --payload "$ROOT/current/pib-runtime" --platform macos --architecture "$(uname -m | sed 's/x86_64/x64/')" --channel stable --allow-unsigned-dev)";
    else [[ -f "$ROOT/current/manifest.sig" ]]||{ echo 'Installed release signature is missing.' >&2;return 1;};current_version="$("$RELEASE_MANAGER" installed-version --manifest "$ROOT/current/manifest.json" --signature "$ROOT/current/manifest.sig" --payload "$ROOT/current/pib-runtime" --public-key "$key_file" --platform macos --architecture "$ARCH" --channel stable)";fi
  fi
  [[ -n "$current_version" ]]||current_version="$(/usr/bin/plutil -extract minimumVersion raw "$metadata")"
  [[ "${3:-}" != rollback ]] || rollback_flag="--allow-downgrade"
  local verify_args=(verify --manifest "$metadata" --payload "$payload" --platform macos --architecture "$ARCH" --current-version "$current_version" --channel stable)
  [[ -z "$unsigned_flag" ]]&&verify_args+=(--signature "$signature_file" --public-key "$key_file")||verify_args+=(--allow-unsigned-dev)
  [[ -z "$rollback_flag" ]]||verify_args+=(--allow-downgrade)
  "$RELEASE_MANAGER" "${verify_args[@]}"
}

install_runtime() {
  require_root
  local stage; stage="$(mktemp -d)"
  # Expand path into the trap string so RETURN cannot hit set -u after locals unwind.
  trap 'rm -rf "'"$stage"'"' RETURN
  curl -fsSL --proto '=https' "$METADATA_URL" -o "$stage/metadata.json"
  local url runtime_version
  url="$(/usr/bin/plutil -extract payloadUrl raw "$stage/metadata.json")"
  runtime_version="$(/usr/bin/plutil -extract version raw "$stage/metadata.json")"
  curl -fsSL --proto '=https' "$url" -o "$stage/pib-runtime"
  chmod 0755 "$stage/pib-runtime"
  verify_release "$stage/metadata.json" "$stage/pib-runtime"
  cp "$stage/metadata.json" "$stage/manifest.json"
  mkdir -p "$ROOT"; rm -rf "$ROOT/previous.new"; [[ ! -d "$ROOT/current" ]] || mv "$ROOT/current" "$ROOT/previous.new"
  mkdir -p "$stage/release"; cp "$stage/pib-runtime" "$stage/release/pib-runtime";cp "$RELEASE_MANAGER" "$stage/release/pib-release-manager";cp "$(dirname "$0")/pib-credential-helper" "$stage/release/pib-credential-helper";chmod 0755 "$stage/release/"*;cp "$stage/manifest.json" "$stage/release/manifest.json";if [[ "${PIB_ALLOW_UNSIGNED_DEV:-0}" == 1 && -z "$PUBLIC_KEY" ]];then touch "$stage/release/.unsigned-dev";else cp "$stage/manifest.sig" "$stage/release/manifest.sig";fi
  mv "$stage/release" "$ROOT/current"; rm -rf "$ROOT/previous"; [[ ! -d "$ROOT/previous.new" ]] || mv "$ROOT/previous.new" "$ROOT/previous"
  # Interactive Terminal Session mode needs a Node.js PTY sidecar + node-pty.
  # The bun-compiled binary cannot load the native addon itself.
  if [[ -f "$(dirname "$0")/pty-host.cjs" ]]; then
    cp "$(dirname "$0")/pty-host.cjs" "$ROOT/current/pty-host.cjs"
    chmod 0644 "$ROOT/current/pty-host.cjs"
  fi
  if command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
    (
      cd "$ROOT/current"
      [[ -f package.json ]] || printf '%s\n' '{"name":"partnersinbiz-runtime-sideload","private":true}' > package.json
      npm install --omit=dev --no-fund --no-audit node-pty@^1.1.0 >/dev/null 2>&1 || true
      find node_modules/node-pty -name spawn-helper -exec chmod +x {} \; 2>/dev/null || true
    ) || true
  else
    echo "Note: install Node.js 20+ and run 'npm install node-pty' in $ROOT/current for Terminal Session mode." >&2
  fi
  local logs="$ROOT/logs";mkdir -p "$logs";chmod 0700 "$ROOT" "$logs";[[ ! -f "$logs/runtime.log" ]]||{ for n in 4 3 2 1;do [[ ! -f "$logs/runtime.log.$n" ]]||mv "$logs/runtime.log.$n" "$logs/runtime.log.$((n+1))";done;mv "$logs/runtime.log" "$logs/runtime.log.1";};touch "$logs/runtime.log";chmod 0600 "$logs/runtime.log"
  mkdir -p "$(dirname "$PLIST")"; sed -e "s|__PIB_RUNTIME_BINARY__|$BIN|g" -e "s|__PIB_RUNTIME_LOG_DIR__|$logs|g" -e "s|__PIB_RUNTIME_VERSION__|$runtime_version|g" "$(dirname "$0")/$LABEL.plist" > "$PLIST"; chmod 0644 "$PLIST"
  # Soft stop: SIGTERM first so the service stops claiming and abandons leases
  # for reclaim instead of hard-killing mid-run (kickstart -k). Wait up to 90s.
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl kill SIGTERM "gui/$(id -u)/$LABEL" 2>/dev/null || true
    local waited=0
    while (( waited < 90 )); do
      if ! pgrep -u "$(id -u)" -f "$ROOT/current/pib-runtime|PartnersInBiz/current/pib-runtime" >/dev/null 2>&1 \
        && ! pgrep -u "$(id -u)" -f "$ROOT/previous/pib-runtime|PartnersInBiz/previous/pib-runtime" >/dev/null 2>&1; then
        break
      fi
      sleep 1
      waited=$((waited + 1))
    done
  fi
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  # Start without -k so we never SIGKILL an in-flight drain that just began.
  launchctl kickstart "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl kickstart -k "gui/$(id -u)/$LABEL"
}

pair_runtime() {
  local challengeId="${1:-}"; shift || true
  [[ "$challengeId" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || { echo "Invalid challengeId." >&2; exit 2; }
  [[ -x "$BIN" ]] || { echo "Install the runtime first." >&2; exit 1; }
  # pib-runtime prompts privately for the one-time code, creates its device key,
  # exchanges the challenge, stores all results in Keychain, then sends a signed
  # heartbeat and starts the outbound local Hermes worker.
  "$BIN" pair --challenge "$challengeId" --platform macos --prompt-code --credential-store keychain "$@"
}

update_runtime() { install_runtime; }
rollback_runtime() {
  require_root
  [[ -x "$ROOT/previous/pib-runtime" ]] || { echo 'No verified previous release.' >&2; return 1; }
  verify_release "$ROOT/previous/manifest.json" "$ROOT/previous/pib-runtime" rollback offline
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl kill SIGTERM "gui/$(id -u)/$LABEL" 2>/dev/null || true
    local waited=0
    while (( waited < 90 )); do
      pgrep -u "$(id -u)" -f 'PartnersInBiz/.*/pib-runtime' >/dev/null 2>&1 || break
      sleep 1
      waited=$((waited + 1))
    done
  fi
  mv "$ROOT/current" "$ROOT/swap"; mv "$ROOT/previous" "$ROOT/current"; mv "$ROOT/swap" "$ROOT/previous"
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl kickstart "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl kickstart -k "gui/$(id -u)/$LABEL"
}
revoke_runtime() { [[ -x "$BIN" ]]||return 0;if ! "$BIN" revoke;then launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1||true;return 1;fi; }
uninstall_runtime() { require_root;local force="${1:-}";if ! revoke_runtime;then if [[ "$force" != --force-local ]];then echo 'Remote revoke pending. Runtime and secure identity retained in revoke-only recovery mode.' >&2;return 1;fi;echo 'WARNING: forcing local removal leaves only a nonsecret recovery marker; revoke this computer in the PiB portal.' >&2;delete_credentials;fi;launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true;rm -f "$PLIST";rm -rf "$ROOT"; }

if [[ "${PIB_INSTALLER_LIBRARY:-0}" != 1 ]];then case "${1:-}" in
  install) install_runtime;; pair) pair_runtime "${2:-}" "${@:3}";; update) update_runtime;; rollback) rollback_runtime;;
  revoke) revoke_runtime;; uninstall) uninstall_runtime "${2:-}";; *) usage; exit 2;;
esac;fi
