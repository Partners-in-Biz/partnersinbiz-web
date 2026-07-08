# Hermes Runtime Routing for Partners in Biz Agents

Partners in Biz does **not** create one Hermes agent per client workspace. The canonical model is:

> Platform agents — Pip, Theo, Maya, Sage, Nora, Ari, Quinn, Luca, Vera, Iris, Silas, Blake — work **inside** the selected client/org space.

Client workspaces provide context, files, CRM records, approvals, and org scope. Agents are the workforce that can be routed to a runtime capable of doing the work.

## Runtime targets

Each `agent_dispatch_configs/{agentId}` document can now contain multiple runtime targets:

```json
{
  "agentId": "pip",
  "baseUrl": "https://hermes-api.partnersinbiz.online/profiles/pip",
  "apiKey": "...legacy vps key...",
  "defaultRuntimeTarget": "vps",
  "runtimeTargets": {
    "vps": {
      "id": "vps",
      "label": "VPS Hermes",
      "baseUrl": "https://hermes-api.partnersinbiz.online/profiles/pip",
      "apiKey": "...",
      "enabled": true,
      "priority": 10,
      "capabilities": ["always-on", "server-runtime"]
    },
    "local": {
      "id": "local",
      "label": "Local Hermes (peets-mac-mini)",
      "baseUrl": "https://<public-mac-runtime>/profiles/pip",
      "apiKey": "...",
      "enabled": true,
      "priority": 1,
      "hostId": "peets-mac-mini",
      "capabilities": ["local-files", "computer-use", "local-browser", "terminal:mac"],
      "lastSeenAt": "server timestamp",
      "lastHealthStatus": "ok"
    }
  }
}
```

Legacy `baseUrl`/`apiKey` still works as a fallback, so this is backward compatible.

## Selection rules

The shared resolver prefers:

1. Explicit runtime preference (`PIB_HERMES_RUNTIME_TARGET` or `PIB_AGENT_RUNTIME_TARGET`, e.g. `local` or `vps`).
2. Fresh local runtime when `PIB_PREFER_LOCAL_HERMES=true`.
3. `defaultRuntimeTarget`.
4. `vps`.
5. Lowest priority enabled target.
6. Legacy `baseUrl`/`apiKey`.

Local targets are only auto-selected when their `lastSeenAt` is fresh. Explicit `local` preference is allowed even without a fresh heartbeat so operators can debug routing intentionally.

## Register the Mac as a local runtime

The repo includes a one-shot heartbeat/registration script:

```bash
PIB_LOCAL_HERMES_PUBLIC_BASE_URL="https://<public-mac-runtime>/profiles" \
PIB_LOCAL_HERMES_API_KEY="<local runtime bearer key>" \
PIB_LOCAL_RUNTIME_HOST_ID="peets-mac-mini" \
npx tsx scripts/register-local-agent-runtime.ts
```

Alternative URL template:

```bash
PIB_LOCAL_RUNTIME_URL_TEMPLATE="https://<public-mac-runtime>/profiles/{agent}" \
PIB_LOCAL_HERMES_API_KEY="<local runtime bearer key>" \
npx tsx scripts/register-local-agent-runtime.ts
```

The public URL must be reachable by `partnersinbiz.online`/the watcher. A loopback-only URL such as `http://127.0.0.1:8642` is useful for local testing but cannot be called by the production PiB server.

Peet's Mac local runtime currently uses:

```bash
PIB_LOCAL_RUNTIME_URL_TEMPLATE="https://hermes-api.partnersinbiz.online/local-profiles/{agent}"
PIB_LOCAL_RUNTIME_HOST_ID="peets-mac-mini"
```

The Mac launchd job `ai.hermes.local-runtime` starts all reusable platform profiles locally, opens reverse SSH tunnels to VPS loopback ports, and re-runs this registrar as a heartbeat every 5 minutes.

Operational guardrails for that local runtime fleet:

- It is API-only. The launcher exports `WHATSAPP_ENABLED=false` and starts each profile with `gateway run --replace --force --quiet` so the local API fleet does not also act as Peet's messaging gateway.
- Local profile cron jobs should not run from this Mac API fleet. On 2026-07-08, existing local `pip`/`theo`/`maya` cron jobs were backed up under each profile's `cron.disabled-local-runtime/<timestamp>/` and active `cron/jobs.json` was emptied. Keep scheduled production work on the intended VPS/default runtime unless a job is deliberately local-only.
- `cron/`, `skills/`, runtime sessions, locks, and secrets are intentionally outside the Mac↔VPS profile-definition sync surface.

Firestore write pitfall: for nested heartbeats, write `runtimeTargets.local` through `update({ 'runtimeTargets.local': value })` or a real nested object. Do not use `set({ 'runtimeTargets.local': value }, { merge: true })`; that can create a literal dotted field named `"runtimeTargets.local"` and leave the actual nested heartbeat stale. If this happens, remove the literal dotted field with `new FieldPath('runtimeTargets.local'), FieldValue.delete()`.

## Client workspace provisioning

`provisionFullClientOnVps()` now provisions only the Cowork/client workspace through Pip's `/admin/client-workspaces` endpoint. It intentionally skips `/admin/profiles` because client workspaces are not agents.

Returned `profile` shape:

```json
{
  "skipped": true,
  "reason": "Partners in Biz agents now work inside client spaces; no per-client Hermes profile is created."
}
```

## Operational note

For Talent Hub or any other client: select the Talent Hub org/workspace in PiB, then route the work to Pip/Theo/Maya/etc. As of 2026-07-08, Peet's Mac local runtime is registered at the `/local-profiles/<agent>` routes with a fresh heartbeat; when `PIB_PREFER_LOCAL_HERMES=true`, the VPS watcher resolves fresh local targets before falling back to VPS. Post-fix verification returned HTTP 200 from all 12 local profile ports and all 12 public `/local-profiles/<agent>/v1/health` routes after restart/warm-up.
