# agent-watcher

A small Node.js daemon that watches Firestore for kanban tasks assigned to a PiB
agent, claims them transactionally, dispatches them to the corresponding Hermes
profile, polls for completion, and writes the result back to the task.

The live policy team is `pip`, `theo`, `maya`, `sage`, `nora`, `ads`,
`qa-release`, `support`, `data`, `docs`, and `seo`.

This implements Step 2-3 of the multi-agent orchestrator spec
(`agents/partners/wiki/multi-agent-orchestrator-spec.md`).

## Architecture

```
                       ┌───────────────────────────────────────┐
                       │  Firestore (partners-in-biz-85059)    │
                       │                                       │
                       │  /organizations/{org}/projects/       │
                       │      {project}/tasks/{task}           │
                       │      assigneeAgentId  ──► 'theo'      │
                       │      agentStatus      ──► 'pending'   │
                       │      requiredCapability ─► 'deploy'   │
                       │      reviewerAgentId  ──► 'qa-release'│
                       │                                       │
                       │  /agent_dispatch_configs/{agentId}    │
                       │      { baseUrl, apiKey, enabled }     │
                       └───────────────▲───────────────────────┘
                                       │ onSnapshot + transactions
                                       │ heartbeats + sweeper
                                       │
              hermes-vps-01 ┌──────────┴──────────┐
              (Hetzner CX23)│   agent-watcher     │
                            │   (systemd unit)    │
                            │   Node.js 18+       │
                            └──────────┬──────────┘
                                       │ POST /v1/runs
                                       │ GET  /v1/runs/{id}   (poll)
                                       │ Authorization: Bearer ...
                                       ▼
                       ┌───────────────────────────────────────┐
                       │  Hermes API (per-agent base URL)      │
                       │  hermes-api.partnersinbiz.online      │
                       │    /chat/* → pip                      │
                       │    /agents/theo/* → theo              │
                       │    /agents/maya/* → maya …            │
                       │    /agents/seo/* → seo                │
                       │    /agents/qa-release/* → qa-release  │
                       └───────────────────────────────────────┘
```

## What it does

- Subscribes via `collectionGroup('tasks')` to every task where
  `assigneeAgentId` is an enabled policy agent and `agentStatus = 'pending'`.
- For each pending task:
  1. Checks any `dependsOn` task IDs — skips until all are `done`.
  2. Skips tasks with pending approval gates.
  3. Atomically claims the task (Firestore transaction; `pending` → `picked-up`).
  4. Loads the agent's Hermes config from `agent_dispatch_configs/<agentId>`
     (60-second in-memory TTL cache).
  5. Moves the task to `in-progress` and starts a 30s heartbeat.
  6. POSTs to `${baseUrl}/v1/runs` with the task spec + provenance metadata.
  7. Polls `${baseUrl}/v1/runs/{runId}` every 2s until the status is terminal
     (5-minute timeout).
  8. Writes `agentOutput.summary` and sets `agentStatus = 'done'` (or `'blocked'`
     with the error in `agentOutput.summary` on failure).
- Caps concurrency at **5 dispatches per agent**. Other tasks are kept in an
  in-process deferred queue and drained as soon as that agent has capacity again.
- Runs a stale-task sweeper every 60 seconds: any task stuck in `picked-up` /
  `in-progress` with `agentHeartbeatAt` older than 5 minutes is reset to
  `pending` so it can be re-claimed (crash-safe).
- Graceful shutdown on `SIGTERM` / `SIGINT`: stops accepting new work, waits up
  to 30 seconds for in-flight tasks to finish, then exits.
- Structured JSON logging to stdout/stderr (one line per event) for journald /
  Loki ingestion.

## Required environment variables

The daemon's only secret is the Firebase Admin service-account credential — all
Hermes endpoints and API keys are pulled from Firestore at runtime, which means
adding a new agent never requires touching this process.

| Variable                       | Required | Notes                                                          |
| ------------------------------ | -------- | -------------------------------------------------------------- |
| `FIREBASE_ADMIN_PROJECT_ID`    | yes      | e.g. `partners-in-biz-85059`                                   |
| `FIREBASE_ADMIN_CLIENT_EMAIL`  | yes      | Service-account email                                          |
| `FIREBASE_ADMIN_PRIVATE_KEY`   | yes      | PEM with literal `\n` newlines — the daemon replaces them      |

> ⚠️ Watch out for the trailing-newline gotcha
> (`reference_vercel_env_newline_gotcha.md`). Use `printf "%s"` when writing
> values into `/etc/hermes/watcher.env`, never `echo`.

## Deployment recipe

All steps run on `hermes-vps-01` (`root@65.108.146.144`) unless otherwise noted.

### 1. Sync the code

From the Mac, in the `partnersinbiz-web` directory:

```bash
rsync -avz --delete \
  --exclude node_modules --exclude dist \
  services/agent-watcher/ \
  root@65.108.146.144:/var/lib/hermes/agent-watcher/
```

### 2. Install dependencies and build

```bash
ssh root@65.108.146.144
cd /var/lib/hermes/agent-watcher
npm install --omit=dev=false   # we need TypeScript for the build
npm run build
```

### 3. Provision the env file

```bash
sudo install -d -m 750 -o hermes -g hermes /etc/hermes
sudo touch /etc/hermes/watcher.env
sudo chown hermes:hermes /etc/hermes/watcher.env
sudo chmod 600 /etc/hermes/watcher.env

# Write keys WITHOUT trailing newline corruption:
sudo bash -c 'printf "%s\n" \
  "FIREBASE_ADMIN_PROJECT_ID=partners-in-biz-85059" \
  "FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxxx@partners-in-biz-85059.iam.gserviceaccount.com" \
  > /etc/hermes/watcher.env'

# Private key needs the literal \n form because it spans multiple lines:
sudo bash -c "printf 'FIREBASE_ADMIN_PRIVATE_KEY=%s\n' \"\$(cat /path/to/service-account.json | jq -r .private_key | sed -z 's/\n/\\\\n/g')\" >> /etc/hermes/watcher.env"
```

### 4. Install and start the systemd unit

```bash
sudo install -m 644 systemd-unit.template /etc/systemd/system/hermes-watcher.service
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-watcher.service
```

### 5. Verify

```bash
sudo systemctl status hermes-watcher.service
sudo journalctl -u hermes-watcher.service -f
```

You should see (one JSON line per event):

```
{"ts":"...","level":"info","msg":"agent-watcher booting","node":"v20.x","pid":12345}
{"ts":"...","level":"info","msg":"starting Firestore watcher","agents":["ads","data","docs","maya","nora","pip","qa-release","sage","seo","support","theo"]}
{"ts":"...","level":"info","msg":"agent-watcher ready"}
```

## Seeding `agent_dispatch_configs`

Each agent needs a doc at `agent_dispatch_configs/<agentId>` before the watcher
will dispatch to it. Run the seed script from the Mac, in the partnersinbiz-web
repo root:

```bash
npx tsx scripts/seed-agent-dispatch-configs.ts
```

The seed script:

1. Reads `hermes_profile_links/pib-platform-owner` to extract `baseUrl` + `apiKey`.
2. Writes `agent_dispatch_configs/<agentId>` with `{ agentId, baseUrl, apiKey, enabled: true }`.
3. Is idempotent — safe to re-run.

## Failure modes

| Symptom                          | What happens                                                        |
| -------------------------------- | ------------------------------------------------------------------- |
| Firestore outage                 | onSnapshot reconnects automatically; sweeper retries on recovery    |
| Hermes endpoint down / 5xx       | runAndPoll throws → task moves to `blocked` with the error message  |
| Hermes run >5 min                | runAndPoll times out → task moves to `blocked: "timed out after …"` |
| Watcher process crash            | systemd `Restart=always`; stale sweeper reclaims any half-done task |
| Two watchers race on same task   | Firestore transaction CAS ensures only one claims                   |
| Agent has no `agent_dispatch_config` | Task moves to `blocked` with explanatory summary; cache is 60s   |
| Bad service-account credentials  | Daemon exits on boot; journald shows the auth error                 |

**Manually unblock a stuck task:** in Firestore, set `agentStatus` back to
`pending` and clear `agentOutput` + `agentHeartbeatAt`. The next snapshot tick
will re-pick it.

## Adding a new agent

1. Add a doc at `agent_dispatch_configs/<newAgentId>` with the new Hermes base URL
   and API key (use a copy of `scripts/seed-agent-dispatch-configs.ts`).
2. Add or enable `agent_team/<newAgentId>`. The watcher derives eligible agents
   from enabled `agent_team` docs at boot and falls back to the policy team only if
   Firestore cannot provide a usable list.
3. Add the runtime skill policy for that agent in `config/agent-skill-policy.json`
   before assigning task-bus work to it.
4. Update the `tasks` collectionGroup index in `firestore.indexes.json` if you
   added new query shapes (the existing index on
   `assigneeAgentId + agentStatus` already covers any agent id).
5. Rebuild and redeploy: `npm run build` + `systemctl restart hermes-watcher`.

## Local development

```bash
cd services/agent-watcher
npm install
npm run build
# Export FIREBASE_ADMIN_* into your shell, then:
npm start
```

The watcher will connect to whichever Firestore project the credentials point
at, so pointing at production-without-realizing is a real risk. Use a sandbox
service account when iterating.
