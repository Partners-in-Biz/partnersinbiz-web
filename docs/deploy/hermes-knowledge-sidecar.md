# Hermes Knowledge Sidecar

**Last updated:** 2026-07-09

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
