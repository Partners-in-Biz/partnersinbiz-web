#!/bin/bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.."&&pwd)";TMP="$(mktemp -d)";trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" PIB_INSTALLER_LIBRARY=1 PIB_RUNTIME_CURRENT_VERSION=1.0.0 PIB_RELEASE_MANAGER="$TMP/release-manager";mkdir -p "$HOME" "$TMP/release"
cat >"$PIB_RELEASE_MANAGER" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >>"$PIB_HARNESS_LOG"
[[ "$1" != installed-version ]]||echo 1.0.0
EOF
chmod +x "$PIB_RELEASE_MANAGER";export PIB_HARNESS_LOG="$TMP/commands"
source "$REPO/runtime-installers/macos/install.sh"
printf '{"channel":"stable","platform":"macos","architecture":"arm64","version":"1.0.0","minimumVersion":"1.0.0","sha256":"x"}' >"$TMP/release/manifest.json";printf payload >"$TMP/release/pib-runtime";touch "$TMP/release/.unsigned-dev"
export PIB_ALLOW_UNSIGNED_DEV=1;verify_release "$TMP/release/manifest.json" "$TMP/release/pib-runtime" rollback offline
unset PIB_ALLOW_UNSIGNED_DEV;if verify_release "$TMP/release/manifest.json" "$TMP/release/pib-runtime" rollback offline 2>/dev/null;then echo 'production accepted unsigned marker' >&2;exit 1;fi
rm "$TMP/release/.unsigned-dev";printf signature >"$TMP/release/manifest.sig";PUBLIC_KEY=public;verify_release "$TMP/release/manifest.json" "$TMP/release/pib-runtime" rollback offline
grep -q -- "--signature $TMP/release/manifest.sig" "$PIB_HARNESS_LOG";! grep -q 'manifest.json.sig' "$PIB_HARNESS_LOG"
