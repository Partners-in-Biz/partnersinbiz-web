#!/bin/bash
# Asserts the permission model that GitHub->VPS sync pipelines AND agent Cowork
# workspaces depend on. Idempotent; runs via hermes-perms.timer, at boot, and
# on-demand via hermes-perms.path when agents request repair.
# Also asserts root-owned /etc/hermes/profiles/*.env are root:hermes 640 so
# hermes-admin-sidecar can authenticate Messages Cowork provision.
# Root only. Agents cannot sudo (NoNewPrivileges on hermes@.service).
set -euo pipefail

LOG_TAG='hermes-perms'
log() { echo "[$LOG_TAG] $*"; }

# --- Sync pipeline ACLs (hermes-deploy) ------------------------------------
chown hermes:hermes /var/lib/hermes
chmod 750 /var/lib/hermes
setfacl -m u:hermes-deploy:rx /var/lib/hermes

mkdir -p /var/lib/hermes/projects /var/lib/hermes/projects/partnersinbiz-web-mirror \
         /var/lib/hermes/agent-skills /var/lib/hermes/pib-skills \
         /var/lib/hermes/partnersinbiz-web/config /var/lib/hermes/partnersinbiz-web/scripts
setfacl -m u:hermes-deploy:rwx,d:u:hermes-deploy:rwx /var/lib/hermes/projects
for tree in /var/lib/hermes/projects/partnersinbiz-web \
            /var/lib/hermes/projects/partnersinbiz-web-mirror \
            /var/lib/hermes/agent-skills \
            /var/lib/hermes/pib-skills \
            /var/lib/hermes/partnersinbiz-web; do
  [ -d "$tree" ] || continue
  setfacl -R -m u:hermes-deploy:rwx,d:u:hermes-deploy:rwx "$tree"
done

# NOTE: /var/lib/hermes/projects/partnersinbiz-web-development is the agents'
# own git clone (hermes-owned). Deliberately untouched by deploy ACLs.

# --- Agent request inbox (no sudo needed to trigger repair) ----------------
REQUESTS=/var/lib/hermes/var/requests
mkdir -p "$REQUESTS"
chown hermes:hermes /var/lib/hermes/var "$REQUESTS"
chmod 755 /var/lib/hermes/var
chmod 775 "$REQUESTS"
setfacl -m u:hermes:rwx,d:u:hermes:rwx "$REQUESTS"

# --- Cowork workspace reclaim ----------------------------------------------
# Mac scp/rsync leaves UID 501; privileged ops leave root. Agents hit EACCES
# and cannot chown/setfacl themselves under NoNewPrivileges.
COWORK=/var/lib/hermes/Cowork
if [ -d "$COWORK" ]; then
  mapfile -t FOREIGN < <(
    find "$COWORK" -xdev \( -user 501 -o -user root \) ! -type l 2>/dev/null || true
  )
  if ((${#FOREIGN[@]} > 0)); then
    log "Reclaiming ${#FOREIGN[@]} foreign-owned paths under Cowork for hermes"
    # Batch chown; keep www-data group on PHP site trees when already set
    printf '%s\0' "${FOREIGN[@]}" | xargs -0 -r chown hermes:hermes
    # Known staging/live PHP checkouts: hermes owner, www-data group for serve
    while IFS= read -r -d '' site; do
      chown -R hermes:www-data "$site" 2>/dev/null || chown -R hermes:hermes "$site"
      setfacl -R -m u:hermes:rwx,u:www-data:rx,m:rwx "$site" 2>/dev/null || true
      setfacl -R -d -m u:hermes:rwx,u:www-data:rx,m:rwx "$site" 2>/dev/null || true
      for writedir in database public/uploads public/tmp storage writable; do
        if [ -d "$site/$writedir" ]; then
          setfacl -R -m u:www-data:rwx "$site/$writedir" 2>/dev/null || true
          setfacl -d -m u:www-data:rwx "$site/$writedir" 2>/dev/null || true
        fi
      done
    done < <(find "$COWORK" -xdev -type d -path '*/source/website' -print0 2>/dev/null)
    # Broader: ensure hermes rwx ACL on any directory that had foreign owners
    # (parent dirs only — cheaper than full-tree ACL every hour)
    parents=()
    for p in "${FOREIGN[@]}"; do
      parents+=("$(dirname "$p")")
    done
    mapfile -t parents < <(printf '%s\n' "${parents[@]}" | sort -u)
    for parent in "${parents[@]}"; do
      [ -d "$parent" ] || continue
      case "$parent" in
        "$COWORK"|"$COWORK"/*) ;;
        *) continue ;;
      esac
      setfacl -m u:hermes:rwx,d:u:hermes:rwx "$parent" 2>/dev/null || true
    done
  else
    log "Cowork ownership clean (no UID 501/root residues)"
  fi

  # Always keep default ACL on Cowork root so new Mac-dropped files inherit hermes write
  setfacl -m u:hermes:rwx,d:u:hermes:rwx "$COWORK" 2>/dev/null || true
fi

# Consume on-demand request marker if present
if [ -f "$REQUESTS/fix-cowork-perms" ]; then
  rm -f "$REQUESTS/fix-cowork-perms"
  log "Consumed on-demand fix-cowork-perms request"
fi

# Keep profile + root auth.json owned by hermes:hermes mode 600.
# A root-owned rewrite (update/login as root) leaves 0600 and the runtime
# user then gets Errno 13 on /v1/runs ("Provider authentication failed").
for f in /var/lib/hermes/auth.json /var/lib/hermes/profiles/*/auth.json; do
  [ -f "$f" ] || continue
  chown hermes:hermes "$f" 2>/dev/null || true
  chmod 600 "$f" 2>/dev/null || true
done

# Sidecar-readable platform profile env files.
# Root-owned /etc/hermes/profiles/*.env rewritten as 0600 root:root (or
# chmod 600 after setfacl -m u:hermes:r) leave a named ACL with mask ---.
# The admin sidecar then 500s Messages Cowork provision (PermissionError on
# pip.env). POSIX model: root:hermes 640. Leave hermes-owned client envs.
PROFILE_ENV_DIR=/etc/hermes/profiles
if [ -d "$PROFILE_ENV_DIR" ]; then
  shopt -s nullglob
  for f in "$PROFILE_ENV_DIR"/*.env; do
    owner=$(stat -c '%U' "$f")
    if [ "$owner" = root ]; then
      # Strip ACLs first: chmod while an ACL is present only updates the mask,
      # and setfacl -b afterwards would restore 0600.
      setfacl -b "$f" 2>/dev/null || true
      chown root:hermes "$f"
      chmod 640 "$f"
    fi
  done
  shopt -u nullglob
fi

log "Permission assert complete"
