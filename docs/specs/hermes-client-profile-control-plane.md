# Hermes Client Profile Control Plane

Date: 2026-05-12
Status: Phase 1 implementation shipped (backend proxy + admin Agent page); Phase 5 VPS deployment artifacts added
Owner: Partners in Biz / Pip

## Implementation status: 2026-05-12

Phase 1 is implemented in `partnersinbiz-web`:

- `lib/hermes/types.ts`, `lib/hermes/access.ts`, `lib/hermes/server.ts`
- `GET/PUT/DELETE /api/v1/admin/hermes/profiles/[orgId]`
- `POST /api/v1/admin/hermes/profiles/[orgId]/runs`
- `GET/POST/PUT/PATCH/DELETE /api/v1/admin/hermes/profiles/[orgId]/dashboard/[...path]`
- Admin workspace UI at `/admin/org/[slug]/agent`
- Workspace nav link: `Agent` / `Agent Control`
- Tests: `__tests__/lib/hermes/access.test.ts`, `__tests__/api/hermes-profiles.test.ts`

Phase 5 deployment artifacts are now documented under `docs/deploy/`:

- VPS runbook: `docs/deploy/hermes-vps.md`
- systemd template: `docs/deploy/hermes@.service`
- per-profile env template: `docs/deploy/hermes-profile.env.example`
- optional nginx/Caddy reverse proxy examples
- health-check script: `scripts/hermes-health-check.sh`

Implemented behavior:

- Browser never receives profile API keys.
- `hermes_profile_links/{orgId}` stores profile, base URL, API key, capability switches, and permission switches.
- Super admins can configure profile links.
- Restricted admins can be allowed per profile but must still have `allowedOrgIds` for the org.
- Clients are disabled by default but can be enabled per profile or explicitly by UID.
- Side-effect capabilities (`terminal`, `files`, `tools`, `cron`, etc.) default on but can be switched off per profile.
- Dashboard-style calls are proxied by the PiB backend to the selected Hermes profile.
- `hermes_runs` records submitted run metadata.

## Goal

Let the Partners in Biz website send work to the correct Hermes profile for the selected client, and eventually expose the same kinds of controls that the Hermes dashboard exposes: task runs, run status/events, cron jobs, model selection, env/API keys, config, tools, skills, sessions, logs, and profile management.

Current deployment assumption: Hermes runs on Peet's Mac.
Future deployment assumption: Hermes moves to a VPS and stays online.

## Short answer

Build a small PiB-side Hermes Control Plane that sits between `partnersinbiz-web` and the local/VPS Hermes profiles.

Do not call a client's Hermes profile directly from the browser.
Do not expose the Hermes dashboard directly to clients.
Do not rely on one shared profile and pass `orgId` in the prompt.

Instead:

1. Each PiB organization has a `hermesProfile` mapping stored in Firestore.
2. Each Hermes profile runs its API server/gateway on an internal port with its own bearer key.
3. PiB backend routes choose the selected org, validate the admin/user has access, look up the profile mapping, and proxy the request server-to-server.
4. PiB stores task/run metadata in Firestore so the website can show history, status, progress, output, and audit trails.
5. Administrative dashboard-equivalent actions are exposed through PiB APIs with an allowlisted set of Hermes dashboard/API-server endpoints.
6. Later, replace local Mac URLs with VPS private URLs without changing the website UX.

## Existing Hermes surfaces we can use

### Hermes API Server, per profile

Enable per profile by adding to each profile's `.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8643
API_SERVER_KEY=<profile-secret>
API_SERVER_MODEL_NAME=<profile-name>
```

Start with:

```bash
hermes -p <profile> gateway run
```

Important endpoints:

- `POST /v1/runs` — start long-running task, returns `run_id` immediately.
- `GET /v1/runs/{run_id}` — poll run state.
- `GET /v1/runs/{run_id}/events` — SSE progress/tool events.
- `POST /v1/runs/{run_id}/approval` — resolve pending approvals.
- `POST /v1/runs/{run_id}/stop` — cancel a running run.
- `POST /v1/responses` — stateful OpenAI Responses-style conversation.
- `POST /v1/chat/completions` — OpenAI-compatible chat completion.
- `GET /v1/models` and `GET /v1/capabilities` — discovery.
- `GET/POST/PATCH/DELETE /api/jobs` — lightweight jobs/cron CRUD exposed by API server.

Use this for: task execution, progress, cancellation, approvals, and basic scheduled jobs.

### Hermes Web Dashboard REST API, per profile or per selected HERMES_HOME

The dashboard exposes REST endpoints behind an ephemeral session token:

- `GET/PUT /api/config`
- `GET /api/config/defaults`
- `GET /api/config/schema`
- `GET /api/model/options`
- `GET /api/model/info`
- `POST /api/model/set`
- `GET/PUT/DELETE /api/env`
- `GET /api/sessions`
- `GET /api/sessions/{id}/messages`
- `GET /api/logs`
- `GET /api/analytics/usage`
- `GET/POST/PUT/DELETE /api/cron/jobs...`
- `GET/PUT /api/skills...`
- `GET /api/tools/toolsets`
- `GET/POST/DELETE /api/profiles...`

Use this for: dashboard-equivalent admin controls.

Caveat: the dashboard is designed as localhost-first and no-public-auth. For production, either:

1. Do not expose it to the network. Run it behind the PiB backend on localhost/private network only.
2. Or better: implement a small dedicated `hermes-control-agent` service that imports the same Hermes Python modules or shells out to `hermes` CLI, and exposes only the endpoints PiB needs with stable API-key auth.

## Recommended architecture

```text
Browser
  |
  | Firebase session cookie / admin auth
  v
partnersinbiz-web Next.js API routes
  |
  | validates org access + audit logs + rate limits
  v
PiB Hermes Control Plane module
  |
  | server-to-server bearer auth, per org/profile
  v
Hermes profile API server(s)
  |
  | profile-isolated tools/memory/cron/config
  v
Mac today / VPS tomorrow
```

## Firestore data model

### `organizations/{orgId}` additions

```ts
hermes?: {
  enabled: boolean
  profileName: string
  profileId?: string
  baseUrl: string              // internal only, e.g. http://127.0.0.1:8643 or http://hermes-vps:8643
  apiKeySecretRef: string      // never store raw key client-visible
  dashboardBaseUrl?: string    // optional internal dashboard proxy target
  dashboardTokenSecretRef?: string
  mode: 'local-mac' | 'vps' | 'disabled'
  allowedActions: string[]     // e.g. ['task.run','cron.manage','model.manage']
  defaultConversation?: string // e.g. `pib-org-${orgId}`
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `hermes_profile_links/{orgId}`

Use a separate collection if we want tighter security rules and easier operational listing:

```ts
type HermesProfileLink = {
  orgId: string
  profileName: string
  baseUrl: string
  apiKeySecretRef: string
  dashboardBaseUrl?: string
  dashboardTokenSecretRef?: string
  status: 'active' | 'paused' | 'missing' | 'error'
  capabilities?: Record<string, unknown>
  lastHealthCheckAt?: Timestamp
  lastError?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `hermes_runs/{runId}`

```ts
type HermesRun = {
  orgId: string
  profileName: string
  hermesRunId?: string
  requestedBy: string
  source: 'admin-ui' | 'client-portal' | 'api' | 'cron'
  title: string
  prompt: string
  instructions?: string
  status: 'queued' | 'started' | 'running' | 'requires_approval' | 'completed' | 'failed' | 'cancelled'
  output?: string
  error?: string
  eventsPreview?: Array<{
    at: Timestamp
    type: string
    message?: string
    tool?: string
    status?: string
  }>
  metadata?: Record<string, unknown>
  createdAt: Timestamp
  updatedAt: Timestamp
  completedAt?: Timestamp
}
```

### `hermes_audit_logs/{id}`

Record every control action:

```ts
type HermesAuditLog = {
  orgId: string
  profileName: string
  actorUid: string
  action: string
  requestSummary: string
  target?: string
  result: 'success' | 'failure'
  error?: string
  createdAt: Timestamp
}
```

## PiB backend module layout

Create these files in `partnersinbiz-web`:

```text
lib/hermes/
  types.ts
  profile-links.ts        // Firestore lookups + access guard helpers
  client.ts               // fetch wrapper for Hermes API Server
  dashboard-client.ts     // fetch wrapper for dashboard REST, only if we proxy dashboard APIs
  runs.ts                 // start/poll/stop/approve runs + Firestore metadata
  cron.ts                 // jobs CRUD wrapper
  config.ts               // allowlisted config/model/env/tool/skill operations
  prompts.ts              // task prompt templates with org context

app/api/v1/hermes/
  profiles/route.ts
  profiles/[orgId]/health/route.ts
  runs/route.ts
  runs/[runId]/route.ts
  runs/[runId]/events/route.ts
  runs/[runId]/stop/route.ts
  runs/[runId]/approval/route.ts
  jobs/route.ts
  jobs/[jobId]/route.ts
  jobs/[jobId]/pause/route.ts
  jobs/[jobId]/resume/route.ts
  jobs/[jobId]/run/route.ts
  config/route.ts
  model/options/route.ts
  model/set/route.ts
  tools/route.ts
  skills/route.ts
  sessions/route.ts
  logs/route.ts
```

Keep the public/client portal surface much narrower than the internal admin surface.

## API shape from PiB to website

### Start task

`POST /api/v1/hermes/runs`

```json
{
  "orgId": "LF9CbnYBEjarEHDBMDaR",
  "title": "Write first welcome email",
  "prompt": "Draft a welcome email for new leads...",
  "mode": "run",
  "conversation": "pib-org-LF9CbnYBEjarEHDBMDaR"
}
```

PiB backend transforms to Hermes:

```json
{
  "input": "<org context>\n\nTask: Draft a welcome email...",
  "session_id": "pib-org-LF9CbnYBEjarEHDBMDaR",
  "conversation": "pib-org-LF9CbnYBEjarEHDBMDaR"
}
```

### Poll task

`GET /api/v1/hermes/runs/{runId}` returns PiB-stored metadata plus latest Hermes state.

### Stream progress

`GET /api/v1/hermes/runs/{runId}/events` proxies Hermes SSE and also writes condensed events to `hermes_runs/{runId}.eventsPreview`.

### Stop task

`POST /api/v1/hermes/runs/{runId}/stop` calls Hermes `POST /v1/runs/{hermesRunId}/stop`.

### Cron jobs

Use PiB endpoints that proxy to either:

- Hermes API Server `/api/jobs` for stable API-server job CRUD.
- Or Hermes dashboard `/api/cron/jobs` if we need the exact dashboard behavior.

Preferred first implementation: Hermes API Server `/api/jobs`, because it already uses bearer auth and is meant for external clients.

## Profile deployment on Mac today

Example local profile ports:

```text
profile                    api port  dashboard port
cowork                     8642      9119
partners-main              8650      9120
i-am-ballito               8651      9121
elemental                  8652      9122
deidre-ras-biokinetics     8653      9123
vikings-wrestling          8654      9124
prime-perform              8655      9125
elza-cilliers              8656      9126
lead-rescue                8657      9127
echo                       8658      9128
```

Start commands:

```bash
hermes -p i-am-ballito gateway run
hermes -p elemental gateway run
hermes -p deidre-ras-biokinetics gateway run
```

Use launchd on macOS for persistence now. On VPS, use systemd units or Docker Compose.

## VPS deployment later

Phase 5 VPS migration/deployment artifacts now live in `docs/deploy/`, with the operational runbook in `docs/deploy/hermes-vps.md`. Use that runbook as the source of truth for systemd setup, per-profile env files, reverse proxy examples, firewall/private-network guidance, health checks, profile port mapping, migration from the local Mac, backups, rollback, and PiB `hermes_profile_links` updates.

Use one of two models.

### Option A: one process per profile, different ports

Simplest and closest to current Hermes design.

```text
hermes@i-am-ballito.service -> API_SERVER_PORT=8651 hermes -p i-am-ballito gateway run
hermes@elemental.service    -> API_SERVER_PORT=8652 hermes -p elemental gateway run
```

PiB stores `baseUrl` per org.

Pros: maximum isolation, no custom Hermes code.
Cons: many processes as client count grows.

### Option B: local control-plane daemon starts profile processes on demand

Run one Node/Python daemon on the VPS:

- knows profile -> port mappings
- starts gateway if stopped
- health-checks profile
- proxies requests
- restarts crashed profile

Pros: better operations, supports many profiles.
Cons: custom daemon to maintain.

Recommended path: start with Option A, design PiB `baseUrl` mapping so Option B can replace it later.

## Security requirements

1. Browser never sees Hermes API keys, dashboard tokens, local URLs, raw env values, or profile paths.
2. PiB backend checks Firebase user access to `orgId` before every call.
3. Restricted admins can only act on `allowedOrgIds[]`.
4. PiB endpoint allowlists actions; no arbitrary URL proxy.
5. Dashboard proxy endpoints must be admin-only, not client portal.
6. Env/API-key management should be super-admin only.
7. Run prompts must inject the selected org context and profile name, and state: "Only act for this org/client." This is defense-in-depth; profile isolation is the real boundary.
8. All destructive actions require either Hermes approvals or a PiB confirmation flow.
9. Audit log every task, config change, cron change, model change, env change, and stop/approval action.
10. When moving to VPS, put Hermes on private networking if possible. If public, use HTTPS + reverse proxy + bearer keys + firewall allowlist for Vercel outbound limitations if feasible.

## Product UX

In PiB admin client screen:

- Add an "Agent" tab for the selected client.
- Header: profile name, status, model, tools enabled, last seen.
- Task composer: prompt textarea + preset task templates.
- Run list: queued/running/completed/failed, output, tool activity summary, stop button.
- Cron tab: list/create/pause/resume/run/delete scheduled tasks.
- Settings tab, admin-only: model, provider, toolsets, skills, config, env keys.
- Sessions tab: recent Hermes sessions for that profile.
- Logs tab: filtered Hermes logs, super-admin only.

Client portal could later get a narrow version: request work, view approved outputs, no model/env/config access.

## Implementation phases

### Phase 1 — Task runner MVP

- Add Firestore `hermes_profile_links` mapping.
- Configure 2-3 profiles with API server enabled on local ports.
- Add `lib/hermes/client.ts` and `lib/hermes/runs.ts`.
- Add `POST /api/v1/hermes/runs`, `GET /runs/{id}`, `POST /runs/{id}/stop`.
- Add admin UI task composer and run history.
- Verify with one selected client.

### Phase 2 — Progress and approvals

- Proxy `/v1/runs/{id}/events` SSE.
- Persist condensed event previews.
- Add UI for tool progress and final output.
- Add approval-resolution endpoint/UI for Hermes approval prompts.

### Phase 3 — Cron/jobs

- Add jobs CRUD endpoints wrapping Hermes API server `/api/jobs`.
- Add Agent > Scheduled tasks UI.
- Persist audit logs for job actions.

### Phase 4 — Dashboard-equivalent admin controls

- Decide whether to proxy Hermes dashboard REST or build a dedicated `hermes-control-agent` daemon.
- Implement allowlisted config/model/tool/skill/env endpoints.
- Add model picker using `/api/model/options` + `/api/model/set` or CLI-backed equivalent.
- Add sessions/logs/analytics UI.

### Phase 5 — VPS migration

Artifact status: deployment docs/scripts created under `docs/deploy/` and `scripts/`.

- Export/import profiles to VPS.
- Replace profile `baseUrl` values.
- Create systemd units or Docker Compose services per profile.
- Add monitoring/health checks.
- Add backups for `~/.hermes/profiles/*`, sessions, cron jobs, skills, and Obsidian workspace if relevant.
- Follow `docs/deploy/hermes-vps.md` for the concrete migration checklist and done criteria.

## Open questions

1. Which PiB users should be allowed to trigger agents: Peet/super-admin only, PiB staff admins, or clients too?
2. Should named agent profiles be allowed to run terminal/file tools, or should some profiles be locked down to safer toolsets?
3. Should Hermes outputs be allowed to directly publish/send changes, or should every external side effect require review?
4. Which dashboard features are required in v1: cron, model selection, env keys, tools/skills, sessions/logs, profile creation?
5. For VPS: do we prefer long-running named agent processes (`pip`, `theo`, `maya`, `sage`, `nora`) or an on-demand daemon that starts agents as needed?

Note: the later multi-agent architecture supersedes the earlier "Hermes profile per client" assumption. Client/org context is passed into named agents per conversation/task; PiB should not create a Hermes Agent profile automatically for each new client.

## Recommended decision

Build Phase 1 now using Hermes API Server per profile. It is the least risky path, requires no Hermes core changes, works locally today, and migrates cleanly to VPS by changing `baseUrl` mappings.

Treat the Hermes dashboard REST API as a reference/control surface, not as the first integration target. For task execution and cron, use the API Server. For model/config/env/tools/skills, either proxy dashboard REST through PiB with strict allowlists or build a dedicated `hermes-control-agent` service once the MVP proves useful.
