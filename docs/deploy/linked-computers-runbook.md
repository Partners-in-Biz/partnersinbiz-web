# Linked Computers Operations Runbook

Date: 2026-07-13

## Architecture and trust boundary

Linked computers are outbound-only clients. PiB authorises an organisation, user, device, grant, Workspace mapping, capability, heartbeat and credential, then encrypts the logical request into `linked_device_run_jobs`. The device polls fixed PiB HTTPS claim/progress/completion endpoints. It never exposes a public listener, registers a runtime URL, or requires an inbound tunnel.

Pairing and heartbeat reject `runtimeEndpoint`, `bootstrapTransport`, and `transportToken`. The server has no direct linked-device Hermes adapter and does not create or read `linked_device_runtime_transports` during normal operation.

Every device request signs the method, exact path, timestamp, fresh request ID and raw body. Queue work is fenced by device, credential version, attempt and opaque lease token. The runtime resolves the server-issued mapping ID in its private `0600` registry, invokes Hermes over loopback, and submits signed body-digest receipts. PiB verifies the receipt before finalising the assistant message.

## Pairing

1. The signed-in owner creates a challenge in Settings > Linked Computers.
2. Transfer only the opaque challenge ID and enter the short-lived secret privately at the installer/runtime prompt. Do not put the secret in command history, URLs, logs or analytics.
3. The device creates its Ed25519 key locally, proves possession, and exchanges the challenge once. Challenges expire after ten minutes, allow at most five attempts, and cannot be replayed.
4. Confirm the browser response is `Cache-Control: no-store`, the device appears for its owner only, and no credential, public key, endpoint or physical path appears in the DTO.

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
npx tsx scripts/cleanup-linked-runtime-transports.ts --apply --device-id=DEVICE_ID
npx tsx scripts/cleanup-linked-runtime-transports.ts --apply
```

Apply deletes `linked_device_runtime_transports` documents and removes only the allowlisted legacy endpoint/token fields from linked device, credential, and rotation-delivery rows. It retains device credentials, credential hashes, rotation credentials, mappings, grants, queue jobs, and audits. Operations are idempotent and write one counts-only `legacy_transport.cleaned` audit. Production apply requires explicit approval.

## Incident and debugging checklist

- Pairing: check expiry, attempt count, consumed state, key proof and clock skew. Never print the secret.
- Offline/stale: check signed heartbeat, server timestamp, health, minimum version and active credential. Do not select a replacement automatically.
- Missing target: check current actor/owner membership, active grant/capability and exact Workspace mapping.
- Queue: inspect logical IDs/status/attempt/lease time only. Never dump encrypted payloads or credentials. A stale lease may be reclaimed; a stale token must not complete.
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
