# Hermes Knowledge Sidecar

**Last updated:** 2026-08-31

Partners exposes Obsidian-style Markdown knowledge in the web app through Pip's Hermes admin sidecar.

## Live VPS State

- Vault root: `/var/lib/hermes/cowork-wiki`
- Shared knowledge root: `/var/lib/hermes/cowork-wiki/shared`
- Client knowledge root pattern: `/var/lib/hermes/cowork-wiki/agents/<client-slug>`
- Allowed sections: `index`, `wiki`, `raw`, `logs`
- Sidecar service: `hermes-admin-sidecar.service`
- Live sidecar source: `/var/lib/hermes/admin_sidecar.py`
- Repo-tracked sidecar source: `infra/hermes/admin_sidecar.py`
- Public route shape: `https://hermes-api.partnersinbiz.online/profiles/pip/admin/knowledge`

The sidecar endpoint is authenticated with the profile API key. The Next.js app does not store or expose that key in the browser; it calls `/api/v1/admin/knowledge`, which uses the existing encrypted `agent_team/pip` key via `callAgentPath`.

## Profile env readability (Messages provision)

`hermes-admin-sidecar` runs as `hermes` and reads `/etc/hermes/profiles/<profile>.env` on every `/admin/*` call, including `POST /admin/client-workspaces` (Messages company Cowork ensure).

Required POSIX mode for **root-owned** platform env files: `root:hermes` `640`. Do **not** `chmod 600` those files after adding a `u:hermes:r` ACL — `chmod 600` zeros the ACL mask (`effective:---`) and the sidecar returns a raw `Internal Server Error`. That is the `VPS workspace provisioning failed: {"raw":"Internal Server Error"}` banner.

`infra/hermes/hermes-perms-assert.sh` (15-minute timer on the VPS) re-asserts `root:hermes` `640` on root-owned `*.env` files. Unreadable env files must 503 `profile env unreadable`, not 500.

## Client Workspace provisioning route

The same sidecar also owns Pip's Workspace provisioning endpoint:

```http
POST /profiles/pip/admin/client-workspaces
```

`partnersinbiz-web` sends the rich payload built by `lib/client-provisioning/provisioner.ts`. The route must preserve existing files by default and consume:

- `clientName`, `domain`, `orgId`, `agentName`
- `workspacePath` under `/var/lib/hermes/Cowork`
- `agentDomainPath` under `/var/lib/hermes/cowork-wiki/agents`
- `workspaceFolders`, including nested folders such as `assets/private` and `operations/admin`
- `manifest`, written to `<workspace>/.pib-workspace.json`
- `workspaceInstructions`, used for `AGENTS.md` and `CLAUDE.md`
- `folderRegistry`, accepted for response/audit metadata

Legacy per-client Hermes profile configuration is disabled by default for this route. Only reusable PiB profiles (`pip`, `theo`, `maya`, etc.) run agent work; selected client context comes from `orgId` + `workspaceContext`.

Deploy the repo-tracked sidecar after reviewing the diff:

```bash
scripts/deploy-hermes-admin-sidecar.sh
```

The deploy script compiles locally, backs up the live file on the VPS, copies `infra/hermes/admin_sidecar.py`, compiles remotely, restarts `hermes-admin-sidecar.service`, and checks that the service is active. Override target values with `HERMES_SIDECAR_HOST`, `HERMES_SIDECAR_PATH`, or `HERMES_SIDECAR_SERVICE` if needed.

## Local Workspace pull

The VPS remains canonical. Preview a pull without changing local files:

```bash
npm run workspace:pull -- --workspace "Vikings Wrestling" --dry-run
```

Pull the Workspace and its Obsidian agent domain to this Mac:

```bash
npm run workspace:pull -- --workspace "Vikings Wrestling" --apply
```

The command validates folder/domain/host input, never uses `--delete`, never pushes local files to the VPS, excludes nested Git metadata and keeps replacement backups under `.pib-pull-backups/<timestamp>`. Use `--plan` to print the exact argument-safe rsync plan without connecting.

For baseline-aware ongoing synchronisation, use `npm run workspace:sync`. It is also plan-first and pull-default. It hashes the Workspace plus matching agent domain, records the last common baseline outside both trees, blocks conflict overwrites, and requires `--apply --allow-push` before any local-to-VPS transfer. See `docs/deploy/workspace-folder-sync-v1.md` for commands and the complete safety contract.

## Workspace integrity and cleanup audit

Run the read-only Firestore/local/VPS audit before moving or deleting any legacy directories:

```bash
npm run workspace:audit -- --check-vps
```

Reports are generated under `scripts/workspace-audit-reports/` and classify missing local pulls separately from canonical VPS failures. Directories containing `.git`, `AGENTS.md`, or `CLAUDE.md` are reported as recognised non-Workspace projects. Known shared agent domains are reserved. Any remaining unmapped entries are manual-review candidates only; the audit never deletes or moves them.

Latest verified run (2026-07-10): 28 active Workspaces, 28 `ok`, 0 not pulled, 0 review required, 5 recognised project directories, 0 unmapped top-level directories, and 0 unmapped agent domains.

## Endpoint Contract

List notes:

```http
GET /profiles/pip/admin/knowledge?scope=shared
GET /profiles/pip/admin/knowledge?scope=agent&agent=loyalty-plus&section=wiki
GET /profiles/pip/admin/knowledge?scope=agent&agent=loyalty-plus&section=raw
GET /profiles/pip/admin/knowledge?scope=agent&agent=loyalty-plus&section=logs
GET /profiles/pip/admin/knowledge?scope=agent&agent=loyalty-plus&section=index
```

Read a note:

```http
GET /profiles/pip/admin/knowledge?scope=agent&agent=partners&section=wiki&path=hot.md
```

Write a note:

```http
POST /profiles/pip/admin/knowledge
Content-Type: application/json

{
  "scope": "agent",
  "section": "wiki",
  "agent": "partners",
  "path": "example.md",
  "content": "# Example\n"
}
```

The sidecar only allows `.md` paths inside the selected section root. On save it writes UTF-8 Markdown and attempts a git commit in `/var/lib/hermes/cowork-wiki`.

## Website Routes

- Shared/admin wiki: `/admin/knowledge`
- Client wiki: `/admin/org/[slug]/wiki`
- API proxy: `/api/v1/admin/knowledge`
- Alias: the website maps org slug `partners-in-biz` to vault agent folder `partners`, because the live populated folder is `agents/partners`.
- Graph mode loads all four sections (`index`, `wiki`, `raw`, `logs`) and resolves links across sections where note names match.

## Smoke Test

Run from the VPS without printing the key:

```bash
KEY=$(grep '^API_SERVER_KEY=' /etc/hermes/profiles/pip.env | cut -d= -f2-)
curl -fsS -H "Authorization: Bearer $KEY" \
  "https://hermes-api.partnersinbiz.online/profiles/pip/admin/knowledge?scope=agent&agent=partners&section=wiki&path=hot.md"
```
