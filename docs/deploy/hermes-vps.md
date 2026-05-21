# Hermes VPS deployment runbook for Partners in Biz

Status: Legacy Phase 5 deployment artifact; superseded by the named-agent VPS topology (`pip`, `theo`, `maya`, `sage`, `nora`)
Scope: historical runbook for running multiple Hermes profile API servers on a VPS

This document predates the multi-agent architecture. Do not use it to provision one Hermes Agent profile per client. Current PiB architecture keeps a small fixed set of named agent profiles and passes `orgId`/client context per conversation or task.

## Target architecture

Historical first VPS shape: one long-running Hermes API server process per profile, managed by systemd. Current target shape is one long-running process per named agent profile, not per client organization.

```text
partnersinbiz-web API routes
  -> server-side Firestore hermes_profile_links/{orgId}
  -> http://private-vps-ip:<profile-port> or https://hermes-api.example.com/profiles/<profile>
  -> hermes@<profile>.service
  -> /var/lib/hermes/profiles/<profile>
```

Keep each profile isolated by profile name, API key, port, working files, cron/jobs, skills, and memory. Do not expose profile API keys or raw Hermes URLs to browsers.

## Included artifacts

- `docs/deploy/hermes@.service` — systemd template for `hermes@<profile>.service`.
- `docs/deploy/hermes-profile.env.example` — per-profile environment template.
- `docs/deploy/nginx-hermes-profiles.conf.example` — optional nginx HTTPS path proxy.
- `docs/deploy/Caddyfile.hermes.example` — optional Caddy HTTPS path proxy.
- `scripts/hermes-health-check.sh` — curl-based health checker for one or many profiles.

## Profile port map

Use the same client profile names in Hermes, systemd instance names, PiB Firestore links, and documentation.

| Profile | API port | Optional dashboard port | PiB baseUrl examples |
| --- | ---: | ---: | --- |
| partners-main | 8650 | 9120 | `http://10.0.0.10:8650` or `https://hermes-api.example.com/profiles/partners-main` |
| i-am-ballito | 8651 | 9121 | `http://10.0.0.10:8651` or `https://hermes-api.example.com/profiles/i-am-ballito` |
| elemental | 8652 | 9122 | `http://10.0.0.10:8652` or `https://hermes-api.example.com/profiles/elemental` |
| deidre-ras-biokinetics | 8653 | 9123 | `http://10.0.0.10:8653` or `https://hermes-api.example.com/profiles/deidre-ras-biokinetics` |
| vikings-wrestling | 8654 | 9124 | `http://10.0.0.10:8654` or `https://hermes-api.example.com/profiles/vikings-wrestling` |
| prime-perform | 8655 | 9125 | `http://10.0.0.10:8655` or `https://hermes-api.example.com/profiles/prime-perform` |
| elza-cilliers | 8656 | 9126 | `http://10.0.0.10:8656` or `https://hermes-api.example.com/profiles/elza-cilliers` |
| lead-rescue | 8657 | 9127 | `http://10.0.0.10:8657` or `https://hermes-api.example.com/profiles/lead-rescue` |
| echo | 8658 | 9128 | `http://10.0.0.10:8658` or `https://hermes-api.example.com/profiles/echo` |

Reserve new clients in order from `8659` upward. Avoid changing ports after PiB profile links have been configured unless the Firestore `baseUrl` is updated at the same time.

## VPS prerequisites

Recommended OS: Ubuntu 22.04/24.04 LTS or Debian 12.

1. Create a dedicated user and directories:

```bash
sudo useradd --system --create-home --home-dir /var/lib/hermes --shell /usr/sbin/nologin hermes
sudo mkdir -p /var/lib/hermes /var/log/hermes /etc/hermes/profiles /srv/partnersinbiz
sudo chown -R hermes:hermes /var/lib/hermes /var/log/hermes /srv/partnersinbiz
sudo chmod 750 /etc/hermes /etc/hermes/profiles
```

2. Install Hermes for the `hermes` runtime user, then confirm the binary path:

```bash
command -v hermes
sudo -u hermes HERMES_HOME=/var/lib/hermes hermes --version
```

If `hermes` is not at `/usr/local/bin/hermes`, update `ExecStart` in `docs/deploy/hermes@.service` before installing it.

3. Copy the systemd template:

```bash
sudo cp docs/deploy/hermes@.service /etc/systemd/system/hermes@.service
sudo systemctl daemon-reload
```

## Per-profile env files

For every profile, create `/etc/hermes/profiles/<profile>.env` from `docs/deploy/hermes-profile.env.example`.

Example for `i-am-ballito`:

```bash
sudo install -m 600 -o root -g root docs/deploy/hermes-profile.env.example /etc/hermes/profiles/i-am-ballito.env
sudoedit /etc/hermes/profiles/i-am-ballito.env
```

Set at minimum:

```bash
API_SERVER_ENABLED=true
# Reverse proxy mode: keep this at 127.0.0.1.
# Direct private-network mode: set this to the VPS private IP or 0.0.0.0 and firewall tightly.
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8651
API_SERVER_MODEL_NAME=i-am-ballito
API_SERVER_KEY=<unique-secret-from-openssl-rand-base64-32>
```

Use a unique `API_SERVER_KEY` per profile. Store it only in server-side PiB configuration/Firestore; never expose it to the browser.

## Migrating profiles from local Mac to VPS

Run this once per migration window. Stop local profile gateways before final sync to avoid copying half-written session/job state.

1. Inventory local profiles and ports.
2. Confirm which client org maps to which Hermes profile.
3. On the Mac, stop local `hermes -p <profile> gateway run` processes for profiles being moved.
4. Create a backup archive before copying:

```bash
tar -czf hermes-profiles-$(date +%Y%m%d-%H%M%S).tgz -C ~/.hermes profiles
```

5. Copy selected profiles to the VPS. Example:

```bash
rsync -az --progress ~/.hermes/profiles/i-am-ballito vps:/var/lib/hermes/profiles/
rsync -az --progress ~/.hermes/profiles/elemental vps:/var/lib/hermes/profiles/
```

6. On the VPS, fix ownership:

```bash
sudo chown -R hermes:hermes /var/lib/hermes/profiles
sudo chmod -R u+rwX,go-rwx /var/lib/hermes/profiles
```

7. Create `/etc/hermes/profiles/<profile>.env` for every migrated profile.
8. Start and enable services:

```bash
sudo systemctl enable --now hermes@i-am-ballito.service
sudo systemctl enable --now hermes@elemental.service
sudo systemctl status hermes@i-am-ballito.service
journalctl -u hermes@i-am-ballito.service -f
```

9. Health-check each profile locally on the VPS:

```bash
scripts/hermes-health-check.sh i-am-ballito http://127.0.0.1:8651 '<profile-api-key>'
```

10. Update PiB `hermes_profile_links/{orgId}.baseUrl` from local Mac URLs to VPS URLs.
11. Submit one low-risk run from the PiB admin Agent page for each migrated org.
12. Keep the Mac backup until all clients have passed health and task-run checks.

## Health checks and monitoring

Manual single-profile check:

```bash
scripts/hermes-health-check.sh i-am-ballito http://127.0.0.1:8651 "$I_AM_BALLITO_HERMES_KEY"
```

Targets file check:

```text
# /etc/hermes/health-targets, chmod 600
partners-main|http://127.0.0.1:8650|<key>
i-am-ballito|http://127.0.0.1:8651|<key>
elemental|http://127.0.0.1:8652|<key>
```

```bash
scripts/hermes-health-check.sh --targets-file /etc/hermes/health-targets
```

Suggested cron/systemd timer cadence: every 1-5 minutes. Alert if any target fails twice in a row.

Operational commands:

```bash
systemctl list-units 'hermes@*.service'
systemctl status hermes@i-am-ballito.service
journalctl -u hermes@i-am-ballito.service --since '30 minutes ago'
sudo systemctl restart hermes@i-am-ballito.service
```

The PiB app should record `lastHealthCheckAt` and `lastError` on `hermes_profile_links/{orgId}` once a server-side scheduled health job exists.

## Reverse proxy options

Best option: private networking, no public profile ports. Examples:

- PiB server/runtime and Hermes VPS in the same private VPC.
- WireGuard or Tailscale between PiB runtime and VPS.
- SSH tunnel for temporary testing only.

If a public endpoint is unavoidable, use HTTPS through nginx or Caddy and keep each Hermes process bound to `127.0.0.1`. Use the provided examples:

- nginx: `docs/deploy/nginx-hermes-profiles.conf.example`
- Caddy: `docs/deploy/Caddyfile.hermes.example`

With a path proxy, PiB `baseUrl` should include the profile prefix, e.g. `https://hermes-api.example.com/profiles/i-am-ballito`. The PiB proxy code appends `/v1/runs`, `/v1/models`, etc. to that `baseUrl`.

## Firewall and private network guidance

Minimum stance:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 443/tcp   # only if using public HTTPS reverse proxy
sudo ufw enable
```

Do not allow `8650:8699/tcp` publicly.

For direct private-network PiB access, Hermes must bind to a reachable private address (`API_SERVER_HOST=<private-ip>` or `0.0.0.0`) and UFW must allow only the private subnet/tunnel source:

```bash
sudo ufw allow from 10.0.0.0/24 to any port 8650:8699 proto tcp
```

For reverse proxy access, profile ports should stay bound to `127.0.0.1`; only `443/tcp` is exposed. Keep Hermes `API_SERVER_KEY` checks enabled even behind the proxy.

## PiB env/settings update guidance

Current PiB implementation stores profile routing in Firestore collection `hermes_profile_links`, one document per org ID. After migration, update each moved org:

```json
{
  "orgId": "<org-id>",
  "profile": "i-am-ballito",
  "baseUrl": "http://10.0.0.10:8651",
  "apiKey": "<same-value-as-API_SERVER_KEY>",
  "enabled": true,
  "capabilities": {
    "runs": true,
    "dashboard": false,
    "terminal": true,
    "files": true,
    "tools": true,
    "cron": true,
    "config": false,
    "env": false,
    "logs": false
  },
  "permissions": {
    "allowSuperAdmins": true,
    "allowRestrictedAdmins": true,
    "allowClients": false,
    "allowedClientUids": []
  }
}
```

Notes:

- Use `baseUrl` with no trailing slash.
- For private direct connections, use `http://<private-ip>:<port>`.
- For reverse-proxied public HTTPS, use `https://hermes-api.example.com/profiles/<profile>`.
- Keep `apiKey` server-side only. The existing admin API returns only `hasApiKey`, not the key value.
- Set `enabled: false` before maintenance or before changing a profile URL/key.
- Keep side-effect capabilities off for low-trust client-facing profiles unless Peet explicitly approves them.

## Backups

Back up at least daily:

- `/var/lib/hermes/profiles/*`
- profile session/history files under `HERMES_HOME`
- profile cron/jobs data
- custom skills/tool configuration
- any mounted client workspaces under `/srv/partnersinbiz`
- `/etc/hermes/profiles/*.env` via a secure secret backup process

Example profile backup:

```bash
sudo tar -czf /var/backups/hermes-profiles-$(date +%Y%m%d).tgz -C /var/lib/hermes profiles
```

Keep env/secret backups encrypted and access-restricted.

## Rollback

1. In PiB, set affected `hermes_profile_links/{orgId}.enabled` to `false` or restore the previous local Mac `baseUrl`.
2. Stop the VPS profile service:

```bash
sudo systemctl stop hermes@i-am-ballito.service
```

3. Start the old local Mac gateway for that profile if needed.
4. Run a PiB Agent health/task check before re-enabling client access.

## Phase 5 done criteria

- Every migrated profile has a unique port and API key.
- Every migrated profile has an env file and enabled systemd unit.
- Health checks pass locally and from the PiB backend network path.
- Firestore `hermes_profile_links` point to VPS URLs and correct keys.
- PiB admin Agent page can start, poll, stream/inspect, approve/stop, and record runs for each migrated org.
- Firewall exposes only SSH and required HTTPS/private ports.
- Backups and rollback path are tested.
