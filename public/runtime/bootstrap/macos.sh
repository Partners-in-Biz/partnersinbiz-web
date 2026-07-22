#!/bin/bash
set -euo pipefail

API_BASE="${PIB_API_BASE:-https://partnersinbiz.online}"
CHALLENGE=""; PROFILES="pip"; PROVIDERS="nous"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --challenge) CHALLENGE="${2:-}"; shift 2 ;;
    --profiles) PROFILES="${2:-}"; shift 2 ;;
    --providers) PROVIDERS="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ "$CHALLENGE" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || { echo 'Invalid or missing pairing challenge.' >&2; exit 2; }
[[ "$PROFILES" =~ ^[a-z][a-z0-9-]{0,31}(,[a-z][a-z0-9-]{0,31}){0,7}$ ]] || { echo 'Invalid Hermes profile list.' >&2; exit 2; }
[[ "$PROVIDERS" =~ ^[a-z][a-z0-9-]{0,31}(,[a-z][a-z0-9-]{0,31}){0,5}$ ]] || { echo 'Invalid model provider list.' >&2; exit 2; }
[[ $EUID -ne 0 ]] || { echo 'Run this as your normal Mac user, not root.' >&2; exit 1; }

if ! command -v hermes >/dev/null 2>&1; then
  echo 'Installing Hermes Agent…'
  curl -fsSL --proto '=https' https://hermes-agent.nousresearch.com/install.sh | bash
  export PATH="$HOME/.local/bin:$HOME/.hermes/bin:$PATH"
fi
command -v hermes >/dev/null 2>&1 || { echo 'Hermes installed, but its command is not on PATH. Open a new terminal and rerun this command.' >&2; exit 1; }

IFS=',' read -r -a requested_profiles <<< "$PROFILES"
IFS=',' read -r -a requested_providers <<< "$PROVIDERS"
for profile in "${requested_profiles[@]}"; do
  if [[ ! -d "$HOME/.hermes/profiles/$profile" ]]; then
    hermes profile create "$profile" --description "Partners in Biz $profile agent"
  fi
  echo "Configure the model for $profile. Requested providers: ${requested_providers[*]}"
  hermes -p "$profile" setup model
  hermes -p "$profile" gateway install || true
  hermes -p "$profile" gateway start
done

stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
arch="$(uname -m)"; [[ "$arch" != x86_64 ]] || arch=x64
release_base="${PIB_RUNTIME_RELEASE_BASE:-https://github.com/Partners-in-Biz/partnersinbiz-web/releases/latest/download}"
bundle_url="${PIB_RUNTIME_BUNDLE_URL:-$release_base/partnersinbiz-runtime-macos-$arch-installer.pkg}"
echo 'Installing the signed Partners in Biz runtime…'
curl -fsSL --proto '=https' "$bundle_url" -o "$stage/runtime.pkg"
/usr/sbin/pkgutil --check-signature "$stage/runtime.pkg" | grep -Fq 'Developer ID Installer: The Partners in Business (PTY) LTD (C2BLS65EY4)' || {
  echo 'The PiB installer does not have the expected Apple Developer ID signature.' >&2
  exit 1
}
/usr/sbin/spctl -a -t install -vv "$stage/runtime.pkg"
sudo /usr/sbin/installer -pkg "$stage/runtime.pkg" -target /
installer="/Library/Application Support/PartnersInBiz/Installer-$arch/install.sh"
[[ -x "$installer" ]] || { echo 'The signed PiB runtime installer is incomplete.' >&2; exit 1; }
"$installer" install
"$installer" pair "$CHALLENGE"
echo 'Computer linked. Keep Hermes and the PiB runtime running to stay available.'
