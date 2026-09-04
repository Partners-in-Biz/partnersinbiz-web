# Linked Computers Operations Runbook

Date: 2026-09-03 (runtime v2 leftover close on `development` `3445d16d9`)

## Hermes prerequisite and agent placement

The native PiB runtime is a secure outbound worker, not the agent itself. Hermes Agent must be on PATH before pairing. Pairing still fails before consuming the one-time code when the Hermes **binary** is missing. From runtime protocol 4, PiB — not the bootstrap script — creates the organisation-managed profiles after pair.

Every heartbeat probes Hermes again and records `availableAgents` (grant-filtered, each with `orgId`), `ignoredProfiles`, `hermesVersion`, and a safe health reason. Legacy `availableAgentIds` is inventory only and is never used to deliver organisation keys. `workspace.execute` is advertised only while at least one local agent is healthy. Runtime selection is agent-aware: a computer is unavailable for Theo when it only has Pip, even if the computer and sync worker are online.

Agents are portable. A managed profile may exist only on the linked computer and does not also need a VPS copy. Configure `PIB_LOCAL_HERMES_ROUTES` with one loopback route per local agent only as an advanced override. The VPS remains an optional always-on target, not the ownership source for local agents.

Org keys are delivered only to `availableAgents` whose `orgId` matches the credential's organisation. Do not turn `orgTeamsEnabled` on in production until managed profiles are stamped in the field.

## Architecture and trust boundary

Linked computers are outbound-only clients. PiB authorises an organisation, user, device, grant, Workspace mapping, capability, heartbeat and credential, then encrypts the logical request into `linked_device_run_jobs`. The device polls fixed PiB HTTPS claim/progress/completion endpoints. It never exposes a public listener, registers a runtime URL, or requires an inbound tunnel.

Pairing and heartbeat reject `runtimeEndpoint`, `bootstrapTransport`, and `transportToken`. The server has no direct linked-device Hermes adapter and does not create or read `linked_device_runtime_transports` during normal operation.

Every device request signs the method, exact path, timestamp, fresh request ID and raw body. Queue work is fenced by device, credential version, attempt and opaque lease token. The runtime resolves the server-issued mapping ID in its private `0600` registry, invokes Hermes over loopback, and submits signed body-digest receipts. PiB verifies the receipt before finalising the assistant message.

## Pairing

1. The signed-in owner creates a challenge in Settings > Linked Computers.
2. Transfer only the opaque challenge ID and enter the short-lived secret privately at the installer/runtime prompt. Do not put the secret in command history, URLs, logs or analytics.
3. The device creates its Ed25519 key locally, proves possession, and exchanges the challenge once. Challenges expire after ten minutes, allow at most five attempts, and cannot be replayed.
4. Confirm the browser response is `Cache-Control: no-store`, the device appears for its owner only, and no credential, public key, endpoint or physical path appears in the DTO.
5. The pairing UI and CLI pass `orgId` plus the selected `--agents`. Exchange stamps `ownerUserId` and `setDeviceDesiredAgents`. Non-members receive `provisioningSkippedReason: 'not_an_active_org_member'` and no managed profiles.

## Bootstrap (runtime v2)

Public paste commands live in `public/runtime/bootstrap/{macos.sh,linux.sh,windows.ps1}`. They:

1. Install official Hermes only when the executable is missing (they do not pin or upgrade an existing checkout; the runtime heartbeat does that).
2. Install and pair the signed PiB runtime with `--agents <catalog ids>`.
3. Do **not** run `hermes profile create`, local model setup, or start gateways. The final line is: *Paired. Your agents are being set up by Partners in Biz…*

Windows InternalStaff pairing still uses `-ReleaseChannel` / `--channel internal`. Do not break that line.

After pair, desired-state jobs create `{orgSlug}--{agentId}` profiles (`--no-skills`), write `pib-managed.json`, and apply skill / credential / browser policy. Heartbeat inventory is grant-filtered.

## Runtime config and Hermes channels

`GET /api/v1/linked-computers/[deviceId]/runtime-config` (signed) returns the device's release channel from `platform_config/linked_runtime_channels`: runtime `minVersion` / `targetVersion`, and Hermes `minVersion` / `targetVersion` / `targetTag`.

Admin UI: `/admin/linked-runtime`. Do not bump the **stable** channel until Internal has run a week with no `hermes_update_failed`. Do not promote signed runtime binaries from `development`; release workflows build only from `main`.

Pinned Hermes tag is `v2026.8.31` (0.21.0). Updates use the official installer `bash -s -- --branch {tag} --non-interactive`, not `hermes update --yes`. POSIX update does **not** pause gateways — the runtime stops them first. If the probed Hermes version is below `channel.minVersion`, the claim loop advertises concurrency `0` (heartbeat still runs). Unparseable versions fail open.

## Managed profiles and org guard

- Name: `managedProfileName(orgSlug, catalogAgentId)`, ≤ 40 chars.
- Marker: `{HERMES_HOME}/profiles/{name}/pib-managed.json`. If `marker.orgId !== job.orgId` the runtime returns `org_mismatch` and does not apply skill, credential, or browser policy.
- Skill-digest drift on heartbeat enqueues `sync-policy` (there is no `sync-skills` job).
- Credential apply: if a grant document exists and is not `active`, the job completes `ok: false` (`device grant not active` / runtime `grant_not_active`). Missing grant docs are user-owned devices — do not cancel those jobs.
- Agent-host protocol: `4`. Claim accepts 3 or 4; v3 skips `managedProfile` jobs and leaves them queued.

## Real-profile browsing

Owner-only, per device and org grant. Settings switch: **Let agents on this computer browse as me**. Risk sentence in the UI is spec §H.5 verbatim. Non-owners see the control disabled.

- Snapshot directory is **shared**: `{HERMES_HOME}/browser-profile/{browser}`. Delete it only when no other managed profile still has `use_real_profile: true`.
- Run claim includes `actorUserId` + `orgId`. Runtime fail-closes `real_profile_guard` before Hermes if the profile is real-profile and the actor is not the device owner (missing ids fail closed). Prefix logs `PIB_REAL_PROFILE_GUARD`.
- Grant `paused|revoked` or browsing consent off enqueues `useRealProfile: false`.
- Transcript: `used_real_profile` → status “Browsing as you”.

## Windows workspace.sync

`nativeWorkspaceSyncSupported` is true for win32. Linux remains native protocol `1`. Do not lease native sync to a runtime that reports another version.

## Operator error codes

| Code | Where | What to do |
|---|---|---|
| `hermes_update_required` / `linked_device_hermes_update_required` | server 2.3 / dispatch | Device is non-selectable. Wait for idle update, or check the channel pin. Chat: *Hermes on this computer is too old. It will update automatically when idle.* |
| `hermes_update_failed` | runtime 2.4 / heartbeat `healthReason` | Hermes keeps serving the previous checkout. Inspect `~/.partnersinbiz/hermes-update-state.json`. Retry is gated to once per 6 hours. |
| `org_mismatch` | runtime 2.6 | Profile marker org ≠ job org. Re-pair; do not copy profiles between orgs. |
| `grant_not_active` / `device grant not active` | runtime 2.7 / claim | Pause or revoke is in effect. Resume the grant or stop expecting org work on that machine. |
| `real_profile_guard` | runtime 2.9 | A non-owner chat hit a browse-as-me profile. Should not happen for owner-only grants — treat as an alert. |

Do not enable production `orgTeamsEnabled` or bump runtime `1.1.30` → `1.2.0` / promote to `main` without Peet.

## Device, grant and mapping lifecycle

- Rename and pause/resume are owner actions. Pause blocks discovery, enqueue and claim without deleting audit history.
- An active organisation administrator grants `workspace.execute`; both actor and device owner must have current active membership. Membership loss fails closed at discovery, dispatch and claim.
- The owner creates a server-ID mapping for the exact organisation and Workspace. The physical root exists only in the runtime's private local registry. Canonicalise the root and target, reject symlink components and traversal, and never create missing paths during dispatch.
- Revoke immediately invalidates credentials and dispatch. Remove terminally revokes the device, grants and mappings. Never resurrect revoked grants or removed mappings/devices.
- Explicit linked targets never fall back to VPS, operator-local or another computer.

## Queue leases and callbacks

- Jobs are encrypted at rest with device/job context and queued by device. Queue depth is bounded.
- Claim revalidates active device/credential, owner and actor membership, grant, capability and exact mapping in one transaction.
- Default leases are 90 seconds. The worker sends signed acceptance and progress/renewal every 10 seconds. Attempt and lease token fence old workers after reclaim.
- Completion is accepted only with a valid Ed25519 receipt bound to job ID, request ID, device, mapping, credential version, attempt, lease token, timestamps, machine/version, outcome and output/error SHA-256 plus byte counts.
- Identical duplicate terminal callbacks are idempotent; changed duplicates are denied. Cancellation, expiry and invalid authorisation clear encrypted payloads and safely fail the conversation message.

## Credential rotation and secure stores

- Rotation creates a five-minute overlap and an encrypted, stable delivery ID. The old credential may only claim the pending delivery; the runtime atomically writes and reads back the new identity before acknowledging with the new credential.
- Failed acknowledgement is retried after restart. Acknowledgement clears delivery material. Expired delivery or revoke clears overlap immediately.
- macOS stores identity in Keychain; replacement uses `SecItemUpdate`, falling back to add only when missing, followed by exact readback.
- Windows LocalSystem owns Credential Manager reads/writes. Pairing handoff uses DPAPI LocalMachine, SYSTEM/Administrators ACLs and atomic rename. Logs and errors must never contain credentials or private keys.

## Installer build and signing

Run:

```bash
npx tsx scripts/verify-linked-runtime-installers.ts
bash -n runtime-installers/macos/install.sh
bash -n runtime-installers/build-runtime.sh
bash -n runtime-installers/tests/macos-lifecycle.sh
runtime-installers/build-runtime.sh
```

Release manifests must use canonical Ed25519 signatures, strict SemVer, exact channel/platform/architecture/minimum version and payload hash. Install/update uses atomic version directories and preserves one verified previous bundle. Rollback is offline-only and re-verifies the stored prior manifest/signature. Unsigned development mode requires an explicit marker and is refused by production mode.

## Firestore TTL and indexes

`firestore.indexes.json` declares TTL for pairing challenges (`cleanupAt`), device request nonces (`expiresAt`), credential-rotation deliveries (`cleanupAt`) and run jobs (`cleanupAt`). Pairing keeps its protocol-facing ISO `expiresAt` while storing a Firestore `Timestamp` in `cleanupAt`, because Firestore TTL does not act on ISO strings. Validate locally with `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"`. Deploying indexes/TTL is a production mutation and requires explicit approval. After approved deployment, read back the active Firestore field policies; checked-in JSON alone is not production evidence.

## Rollback and emergency revoke

1. Pause the device or revoke its credential first; this stops discovery, enqueue and claim without relying on the runtime being online.
2. Cancel/expire outstanding jobs and verify encrypted payloads are cleared and messages receive safe typed failures.
3. Roll back the application with a normal revert on `development`; production promotion requires separate approval.
4. Roll back a runtime only to its stored, signed previous bundle. If signature/hash/platform/version validation fails, keep the current version and investigate.
5. For compromise, revoke then remove the device, rotate affected release/device keys, inspect audit rows and nonce/replay activity, and do not reuse pairing material.

## Legacy direct-transport cleanup

The cleanup is dry-run by default and prints counts only; it never prints field values:

```bash
npx tsx scripts/cleanup-linked-runtime-transports.ts
npx tsx scripts/cleanup-linked-runtime-transports.ts --device-id=DEVICE_ID
```

Review the counts before requesting approval. Apply is explicit and may be scoped to one device:

```bash
npx tsx scripts/cleanup-linked-runtime-transports.ts --apply --run-id=RUN_ID --device-id=DEVICE_ID
npx tsx scripts/cleanup-linked-runtime-transports.ts --apply --run-id=RUN_ID
```

Apply creates a durable `linked_computer_migration_runs` row before mutations. Every mutation batch atomically writes its counts-only audit and cumulative checkpoint; completion or failure is recorded on the run. Resume a failed apply with the same `--run-id` and scope. A new run ID safely reconstructs remaining work from current state. Apply deletes `linked_device_runtime_transports` documents and removes only the allowlisted legacy endpoint/token fields from linked device, credential, and rotation-delivery rows. It retains device credentials, credential hashes, rotation credentials, mappings, grants, queue jobs, and audits. Production apply requires explicit approval.

## Incident and debugging checklist

- Pairing: check expiry, attempt count, consumed state, key proof and clock skew. Never print the secret.
- Offline/stale: check signed heartbeat, server timestamp, health, minimum version and active credential. Do not select a replacement automatically.
- Missing target: check current actor/owner membership, active grant/capability and exact Workspace mapping.
- Queue: inspect logical IDs/status/attempt/lease time only. Never dump encrypted payloads or credentials. A stale lease may be reclaimed; a stale token must not complete.

## Source-ready security truth

The server source is ready for staged acceptance only when `LINKED_RUNTIME_MIN_VERSION` is configured to a valid semantic version in production. Older/invalid runtimes are update-required and nonselectable. Previous-version credentials are authorised only for the explicit rotation-delivery claim; every other device API requires the current credential.

Accepted device identity comes from the verified stored acceptance receipt, not the requested target label. Result persistence uses the safe result contract and redaction boundary. Signed hashes and byte lengths remain the integrity record when display output must be replaced with `[redacted output]`.

This wording does not claim installer signing/notarisation, production deployment, real-device acceptance, or rollback drills have passed. Those remain release gates.

Any security or lifecycle change invalidates earlier Task 7 readiness evidence. Task 7 may be marked passed only after a fresh final integrated verification run on the resulting source commit; earlier green evidence is historical, not current release proof.
- Callback: check request nonce, credential version, receipt signature/body digests, registered machine/version and job/request/mapping/attempt/lease binding.
- Filesystem: use the runtime `status` command and safe mapping labels. Physical paths remain local and must not enter browser/API evidence.

## External native and production gates

The source-level implementation is not a production release claim. These gates require external artifacts and remain open until evidenced:

- macOS Developer ID signing, notarisation/stapling, package install, auto-start, update, rollback, revoke and uninstall on supported arm64 and x64 Macs;
- Windows Authenticode/catalog signing and native Windows VM builds/tests for arm64 and x64, including SCM supervision, Credential Manager/DPAPI identity, update, rollback, revoke and uninstall;
- published architecture-specific payloads and protected production release-signing keys;
- Firebase emulator or approved isolated project acceptance for two users/two organisations, plus approved deployment and readback of required TTL/index policies;
- real macOS and Windows organisation/project `pwd` proof, audit/redaction review, rollback drill and explicit production approval.

Do not run `vercel --prod`, merge to `main`, deploy Firestore indexes/TTL, or claim native signing/VM gates passed without Peet's explicit approval and retained artifacts.
