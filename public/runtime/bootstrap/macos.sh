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
  if [[ ! -d "$HOME/.hermes/profiles/$profile" && "$profile" != pip ]]; then
    hermes profile create "$profile" --description "Partners in Biz $profile agent"
  fi
  echo "Configure the model for $profile. Requested providers: ${requested_providers[*]}"
  if [[ "$profile" == pip && ! -d "$HOME/.hermes/profiles/pip" ]]; then hermes setup model; else hermes -p "$profile" setup model; fi
  if [[ "$profile" == pip && ! -d "$HOME/.hermes/profiles/pip" ]]; then hermes gateway install || true; hermes gateway start; else hermes -p "$profile" gateway install || true; hermes -p "$profile" gateway start; fi
done

stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
bundle_url="${PIB_RUNTIME_BUNDLE_URL:-$API_BASE/runtime/macos/installer-bundle.tgz}"
echo 'Installing the signed Partners in Biz runtime…'
curl -fsSL --proto '=https' "$bundle_url" -o "$stage/runtime.tgz"
tar -xzf "$stage/runtime.tgz" -C "$stage"
installer="$(find "$stage" -maxdepth 3 -type f -name install.sh -print -quit)"
[[ -n "$installer" ]] || { echo 'The signed PiB runtime bundle is incomplete.' >&2; exit 1; }
chmod 0755 "$installer"
"$installer" install
"$installer" pair "$CHALLENGE"
echo 'Computer linked. Keep Hermes and the PiB runtime running to stay available.'
