#!/usr/bin/env bash
# Root-owned installer for a skill bundle staged by the unprivileged
# hermes-deploy GitHub Actions account. Install this file at
# /usr/local/sbin/pib-apply-skill-staging (root:root, 0755) and allow only that
# command through sudo. The staging tree is data; no script is executed from it.
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "pib skill staging installer must run as root" >&2
  exit 1
fi

raw_staging=${1:-}
if [[ -z "$raw_staging" ]]; then
  echo "usage: pib-apply-skill-staging <staging-directory>" >&2
  exit 2
fi

staging=$(realpath -e -- "$raw_staging")
if [[ ! "$staging" =~ ^/srv/hermes-projects/pib-skill-staging/[0-9]+-[0-9]+$ ]]; then
  echo "refusing unexpected staging path: $staging" >&2
  exit 2
fi
if [[ $(stat -c '%U' "$staging") != hermes-deploy ]]; then
  echo "staging directory must be owned by hermes-deploy" >&2
  exit 2
fi
if find -P "$staging" -type l -print -quit | grep -q .; then
  echo "staging directory must not contain symlinks" >&2
  exit 2
fi

required=(
  "$staging/.claude/skills"
  "$staging/config/agent-skill-policy.json"
  "$staging/scripts/apply-agent-skill-policy.mjs"
  "$staging/scripts/install-vps-skills.sh"
)
for path in "${required[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "staging bundle is incomplete: $path" >&2
    exit 2
  fi
done

trap 'rm -rf -- "$staging"' EXIT

install -d -o hermes -g hermes -m 2770 \
  /var/lib/hermes/pib-skills/partnersinbiz \
  /var/lib/hermes/partnersinbiz-web/config \
  /var/lib/hermes/partnersinbiz-web/scripts

rsync -rl --delete --omit-dir-times --no-perms --no-owner --no-group \
  "$staging/.claude/skills/" \
  /var/lib/hermes/pib-skills/partnersinbiz/
install -o hermes -g hermes -m 0644 \
  "$staging/config/agent-skill-policy.json" \
  /var/lib/hermes/partnersinbiz-web/config/agent-skill-policy.json
install -o hermes -g hermes -m 0755 \
  "$staging/scripts/apply-agent-skill-policy.mjs" \
  "$staging/scripts/install-vps-skills.sh" \
  /var/lib/hermes/partnersinbiz-web/scripts/
chown -R hermes:hermes /var/lib/hermes/pib-skills/partnersinbiz

sudo -u hermes env HOME=/var/lib/hermes /usr/bin/node \
  /var/lib/hermes/partnersinbiz-web/scripts/apply-agent-skill-policy.mjs \
  --root /var/lib/hermes --apply --no-config --allow-missing-global

mapfile -t active_units < <(
  systemctl list-units 'hermes@*.service' --state=running --no-legend --plain \
    | awk '{print $1}'
)
if (( ${#active_units[@]} > 0 )); then
  systemctl restart "${active_units[@]}"
  systemctl is-active "${active_units[@]}"
fi

logger -t pib-skill-sync "applied staged PiB agent skills and restarted ${#active_units[@]} active profiles"
echo "PiB skill staging apply complete"
