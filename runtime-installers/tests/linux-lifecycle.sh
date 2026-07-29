#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export PIB_INSTALLER_LIBRARY=1
export PIB_LINUX_INSTALLER_TESTING=1
export PIB_LINUX_ROOT="$TMP/opt/partnersinbiz"
export PIB_LINUX_STATE_ROOT="$TMP/var/lib/partnersinbiz"
export PIB_LINUX_UNIT_PATH="$TMP/etc/systemd/system/pib-runtime.service"
export PIB_RUNTIME_ENV_PATH="$TMP/etc/partnersinbiz/runtime.env"
export PIB_RELEASE_MANAGER="$TMP/pib-release-manager"
export PIB_SYSTEMCTL="$TMP/systemctl"
export PIB_RUNTIME_CURRENT_VERSION=1.0.0
export PIB_RUNTIME_UPDATE_PUBLIC_KEY=public
mkdir -p "$(dirname "$PIB_LINUX_UNIT_PATH")" "$(dirname "$PIB_RUNTIME_ENV_PATH")" "$TMP/bin"

cat > "$PIB_RELEASE_MANAGER" <<'SH'
#!/bin/bash
set -euo pipefail
case "${1:-}" in
  verify) printf 'verified\n' ;;
  installed-version) python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "${3}" ;;
  *) exit 2 ;;
esac
SH
cat > "$PIB_SYSTEMCTL" <<'SH'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "${PIB_SYSTEMCTL_LOG:?}"
SH
chmod +x "$PIB_RELEASE_MANAGER" "$PIB_SYSTEMCTL"
export PIB_SYSTEMCTL_LOG="$TMP/systemctl.log"
cat > "$TMP/bin/systemd-creds" <<'SH'
#!/bin/bash
[[ "${1:-}" == --version ]] && printf 'systemd 255\n'
SH
chmod +x "$TMP/bin/systemd-creds"
export PATH="$TMP/bin:$PATH"

# shellcheck source=/dev/null
source "$REPO/runtime-installers/linux/install.sh"

make_release() {
  local dir="$1" version="$2" marker="$3"
  mkdir -p "$dir"
  printf "#!/bin/sh\nprintf '%%s\\\\n' '%s'\n" "$marker" > "$dir/pib-runtime"
  cp "$PIB_RELEASE_MANAGER" "$dir/pib-release-manager"
  printf '#!/bin/sh\n' > "$dir/pib-credential-helper"
  printf '#!/bin/sh\n' > "$dir/pib-file-helper"
  chmod 0755 "$dir"/pib-*
  printf '{"channel":"stable","platform":"linux","architecture":"x64","version":"%s","minimumVersion":"1.0.0","sha256":"test","payloadUrl":"https://example.invalid/pib-runtime"}\n' "$version" > "$dir/manifest.json"
  printf 'signature\n' > "$dir/manifest.sig"
}

make_release "$TMP/release-1" 1.0.0 first
make_release "$TMP/release-2" 1.1.0 second

# The installed-version helper must resolve the manager from its argument,
# regardless of whether a caller also has a variable named `release`.
release="$TMP/wrong-release"
[[ "$(installed_version "$TMP/release-1")" == 1.0.0 ]]

verify_release "$TMP/release-1/manifest.json" "$TMP/release-1/pib-runtime" signed offline
activate_verified_release "$TMP/release-1"
[[ -x "$PIB_LINUX_ROOT/current/pib-runtime" ]]
activate_verified_release "$TMP/release-2"
[[ "$("$PIB_LINUX_ROOT/current/pib-runtime")" == second ]]
[[ "$("$PIB_LINUX_ROOT/previous/pib-runtime")" == first ]]
swap_verified_releases
[[ "$("$PIB_LINUX_ROOT/current/pib-runtime")" == first ]]

# Online staging must retain the public verification key in the activated
# bundle, and a successful update must not fail later from an unbound RETURN
# trap after its local staging variable has unwound.
download() {
  local destination="$2"
  case "$(basename "$destination")" in
    metadata.json) cp "$TMP/release-2/manifest.json" "$destination" ;;
    pib-runtime) cp "$TMP/release-2/pib-runtime" "$destination" ;;
    manifest.sig) cp "$TMP/release-2/manifest.sig" "$destination" ;;
    *) return 2 ;;
  esac
}
install_runtime
[[ -f "$PIB_LINUX_ROOT/current/release-public.pem" ]]
[[ "$(cat "$PIB_LINUX_ROOT/current/release-public.pem")" == public ]]
[[ "$("$PIB_LINUX_ROOT/current/pib-runtime")" == second ]]

mkdir -p "$TMP/unsigned"
cp "$TMP/release-1/"* "$TMP/unsigned/"
touch "$TMP/unsigned/.unsigned-dev"
if verify_release "$TMP/unsigned/manifest.json" "$TMP/unsigned/pib-runtime" signed offline 2>/dev/null; then
  echo 'production accepted unsigned package' >&2
  exit 1
fi
PIB_ALLOW_UNSIGNED_DEV=1 verify_release "$TMP/unsigned/manifest.json" "$TMP/unsigned/pib-runtime" signed offline

printf 'PIB_CHROME_PATH="/usr/local/bin/pib-workbench-chrome"\n' > "$PIB_RUNTIME_ENV_PATH"
install_systemd_assets
grep -q '/opt/partnersinbiz/current/pib-runtime service' "$PIB_LINUX_UNIT_PATH"
grep -q 'TimeoutStopSec=2h' "$PIB_LINUX_UNIT_PATH"
# After install_runtime activated release-2, env must report that current version.
grep -q '^PIB_RUNTIME_VERSION="1.1.0"$' "$PIB_RUNTIME_ENV_PATH"
grep -Fqx "PIB_RUNTIME_STATE_DIR=\"$PIB_LINUX_STATE_ROOT\"" "$PIB_RUNTIME_ENV_PATH"
grep -Fqx "PIB_CREDENTIAL_HELPER=\"$PIB_LINUX_ROOT/current/pib-credential-helper\"" "$PIB_RUNTIME_ENV_PATH"
grep -Fqx "PIB_FILE_HELPER=\"$PIB_LINUX_ROOT/current/pib-file-helper\"" "$PIB_RUNTIME_ENV_PATH"
grep -Fqx 'PIB_API_BASE="https://partnersinbiz.online"' "$PIB_RUNTIME_ENV_PATH"
grep -Fqx 'PIB_CHROME_PATH="/usr/local/bin/pib-workbench-chrome"' "$PIB_RUNTIME_ENV_PATH"
grep -q 'daemon-reload' "$PIB_SYSTEMCTL_LOG"
grep -q 'enable pib-runtime.service' "$PIB_SYSTEMCTL_LOG"

# Pair and map keep secrets out of arguments while passing only the browser
# challenge and the local mapping chosen by the VPS administrator.
cat > "$TMP/fake-runtime" <<'SH'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "${PIB_RUNTIME_CALL_LOG:?}"
printf '%s|%s|%s|%s\n' "${PIB_RUNTIME_STATE_DIR:?}" "${PIB_CREDENTIAL_HELPER:?}" "${PIB_FILE_HELPER:?}" "${PIB_API_BASE:?}" >> "${PIB_RUNTIME_ENV_LOG:?}"
case "${1:-}" in
  status) printf '{"paired":%s}\n' "${PIB_TEST_PAIRED:-false}" ;;
  map) mkdir -p "$PIB_RUNTIME_STATE_DIR";printf '%s\n' "$*" > "$PIB_RUNTIME_STATE_DIR/mapping-state" ;;
  revoke) [[ "${PIB_TEST_REVOKE_FAIL:-0}" != 1 ]] || { mkdir -p "$PIB_RUNTIME_STATE_DIR";printf '{"pending":true}\n' > "$PIB_RUNTIME_STATE_DIR/revocation-pending.json";exit 1; } ;;
esac
SH
chmod 0755 "$TMP/fake-runtime"
cp "$TMP/fake-runtime" "$PIB_LINUX_ROOT/current/pib-runtime"
export PIB_RUNTIME_CALL_LOG="$TMP/runtime-calls.log"
export PIB_RUNTIME_ENV_LOG="$TMP/runtime-env.log"
pair_runtime challenge-safe
map_runtime mapping-safe /srv/project
grep -q '^pair --challenge challenge-safe --platform linux$' "$PIB_RUNTIME_CALL_LOG"
grep -q '^map --mapping mapping-safe --folder /srv/project$' "$PIB_RUNTIME_CALL_LOG"
[[ -f "$PIB_LINUX_STATE_ROOT/mapping-state" ]]
expected_runtime_env="$PIB_LINUX_STATE_ROOT|$PIB_LINUX_ROOT/current/pib-credential-helper|$PIB_LINUX_ROOT/current/pib-file-helper|https://partnersinbiz.online"
[[ "$(sort -u "$PIB_RUNTIME_ENV_LOG")" == "$expected_runtime_env" ]]

# An installed but unpaired runtime is removable without manufacturing a
# revocation failure or retaining an unnecessary identity recovery marker.
export PIB_TEST_PAIRED=false
uninstall_runtime
if grep -q '^revoke$' "$PIB_RUNTIME_CALL_LOG"; then
  echo 'unpaired uninstall attempted remote revocation' >&2
  exit 1
fi
[[ ! -e "$PIB_LINUX_ROOT" ]]

# A paired runtime that cannot reach PiB is retained unless the administrator
# selects the explicit force-local recovery path.
activate_verified_release "$TMP/release-1"
cp "$TMP/fake-runtime" "$PIB_LINUX_ROOT/current/pib-runtime"
export PIB_TEST_PAIRED=true PIB_TEST_REVOKE_FAIL=1
if uninstall_runtime 2>/dev/null; then
  echo 'uninstall discarded a pending remote revocation' >&2
  exit 1
fi
[[ -x "$PIB_LINUX_ROOT/current/pib-runtime" ]]
[[ -f "$PIB_LINUX_STATE_ROOT/revocation-pending.json" ]]
uninstall_runtime --force-local 2>/dev/null
[[ ! -e "$PIB_LINUX_ROOT" ]]
[[ -f "$PIB_LINUX_STATE_ROOT/revocation-pending.json" ]]
