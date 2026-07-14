#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/store"

cat > "$TMP/bin/systemd-creds" <<'SH'
#!/bin/bash
set -euo pipefail
cmd="${1:-}"
shift
case "$cmd" in
  --version) printf 'systemd 255\n' ;;
  encrypt)
    [[ "${FAKE_CREDS_FAIL:-0}" != 1 ]] || exit 70
    output="${@: -1}"
    { printf 'ENCRYPTED:'; base64; } > "$output"
    ;;
  decrypt)
    input="${@: -2:1}"
    tail -c +11 "$input" | base64 --decode
    ;;
  *) exit 2 ;;
esac
SH
chmod +x "$TMP/bin/systemd-creds"

export PATH="$TMP/bin:$PATH"
export PIB_CREDENTIAL_DIR="$TMP/store"
export PIB_CREDENTIAL_HELPER_TESTING=1
HELPER="$REPO/runtime-installers/linux/pib-credential-helper"
IDENTITY='{"deviceId":"device-a","credential":"super-secret","privateKey":"private"}'

printf '%s' "$IDENTITY" | "$HELPER" put identity
[[ "$(stat -f '%Lp' "$TMP/store/identity.cred" 2>/dev/null || stat -c '%a' "$TMP/store/identity.cred")" == 600 ]]
! grep -F 'super-secret' "$TMP/store/identity.cred"
[[ "$("$HELPER" get identity)" == "$IDENTITY" ]]

if printf x | "$HELPER" put '../escape' 2>/dev/null; then exit 1; fi
if printf replacement | FAKE_CREDS_FAIL=1 "$HELPER" put identity 2>/dev/null; then exit 1; fi
[[ "$("$HELPER" get identity)" == "$IDENTITY" ]]

"$HELPER" clear
[[ ! -e "$TMP/store/identity.cred" ]]
