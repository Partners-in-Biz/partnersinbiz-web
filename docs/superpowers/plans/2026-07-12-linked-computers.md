# Self-Service Linked Computers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build secure per-user linked computers with one-time pairing, organisation grants, local folder mappings, heartbeat/credential lifecycle, strict dispatch, product UI, and install/update foundations for macOS and Windows.

**Architecture:** Firestore stores device identity, hashed pairing challenges, organisation grants, mapping metadata, heartbeats, audit events, and encrypted per-device run jobs. A device-authenticated API exchanges short-lived challenges for scoped credentials. PiB dispatch authorises user + organisation + device + grant + mapping and enqueues encrypted work; the local runtime uses outbound-only signed HTTPS calls to claim leased work, resolves logical mapping IDs to contained paths, and returns signed progress/completion receipts. No public device endpoint or inbound tunnel is used.

**Tech Stack:** Next.js App Router, TypeScript, Firebase Admin/Firestore transactions and TTL policies, Node crypto, Jest, macOS launchd package assets, Windows PowerShell/service installer assets, outbound runtime worker, loopback Hermes bridge.

## Global Constraints

- Device private keys never leave the device.
- Pairing secrets are random, hashed at rest, expire within 10 minutes, are attempt-limited, and are consumed atomically once.
- Device credentials are device-scoped, versioned, rotatable, revocable, and absent from browser storage/logs.
- Device discovery and dispatch revalidate user ownership/share, current organisation membership, organisation grant, device state, credential version, heartbeat freshness, capability, and folder mapping.
- Browser APIs expose logical IDs and friendly status only; no raw paths, runtime URLs, permanent secrets, or internal commands.
- Explicit device selection never falls back.
- Devices poll only fixed PiB HTTPS queue endpoints; device-controlled endpoints, inbound tunnels, redirects, and long-lived transport tokens are forbidden.
- Claim/progress/completion is signed, replay-protected, lease-fenced, and bound to exact job/request/device/mapping/credential identities.
- VPS remains canonical; linked computers are local execution mirrors unless an explicit conflict-aware push is approved.
- macOS and Windows support is not claimed complete until signed installer/update/revoke lifecycle evidence exists.
- All behavior changes use red-green TDD.

---

### Task 1: Device, pairing, grant, mapping, and audit domain

**Files:**
- Create: `lib/linked-computers/types.ts`
- Create: `lib/linked-computers/store.ts`
- Create: `lib/linked-computers/policy.ts`
- Create: `__tests__/lib/linked-computers/store.test.ts`
- Modify: `firestore.indexes.json`

- [ ] Write failing emulator/mocked-transaction tests for user ownership, status transitions, org grants, membership loss, multiple Workspace mappings, audit events, and cross-tenant denial.
- [ ] Run the new suite and confirm missing-domain failures.
- [ ] Implement typed collections and transaction-safe store/policy functions with no public secrets or paths.
- [ ] Add only the indexes required by the implemented queries.
- [ ] Run focused tests, typecheck, and index JSON validation; confirm pass.
- [ ] Commit with `feat(devices): add tenant-scoped linked computer domain`.

### Task 2: One-time pairing and device authentication

**Files:**
- Create: `lib/linked-computers/crypto.ts`
- Create: `lib/linked-computers/device-auth.ts`
- Create: `app/api/v1/linked-computers/pairing/route.ts`
- Create: `app/api/v1/linked-computers/pairing/exchange/route.ts`
- Create: `__tests__/api/linked-computer-pairing.test.ts`

- [ ] Write failing tests for 10-minute expiry, hash-only storage, attempt limits, atomic single use, replay denial, wrong-user denial, proof-of-key possession, and redacted responses/logs.
- [ ] Run the suite and confirm failures.
- [ ] Implement challenge creation/exchange using cryptographically random secrets, SHA-256/HMAC hashes, Firestore transactions, and scoped credential issuance.
- [ ] Add device-auth middleware enforcing device ID, credential version, signature/timestamp, and revocation.
- [ ] Re-run focused tests and confirm pass.
- [ ] Commit with `feat(devices): add secure one-time pairing`.

### Task 3: Grants, mappings, heartbeat, rotation, and revocation APIs

**Files:**
- Create: `app/api/v1/linked-computers/route.ts`
- Create: `app/api/v1/linked-computers/[deviceId]/route.ts`
- Create: `app/api/v1/linked-computers/[deviceId]/grants/route.ts`
- Create: `app/api/v1/linked-computers/[deviceId]/mappings/route.ts`
- Create: `app/api/v1/linked-computers/[deviceId]/heartbeat/route.ts`
- Create: `app/api/v1/linked-computers/[deviceId]/credentials/rotate/route.ts`
- Create: `__tests__/api/linked-computer-lifecycle.test.ts`

- [ ] Write failing lifecycle tests for list/update, admin grant/revoke, owner mapping, heartbeat freshness, pause/resume, rotation overlap, old-version rejection, revoke, remove, membership loss, and cross-device/cross-org denial. Device creation remains exclusively behind the secure pairing-exchange route; the collection intentionally exposes no `POST`.
- [ ] Run the suite and confirm failures.
- [ ] Implement user/admin/device-authenticated routes using the central policy/store functions and safe DTOs.
- [ ] Re-run lifecycle tests and confirm pass.
- [ ] Commit with `feat(devices): add grants mappings and credential lifecycle`.

### Task 4: Device-authorised runtime discovery and outbound queue dispatch

**Files:**
- Create: `lib/linked-computers/runtime-targets.ts`
- Create: `lib/linked-computers/run-queue.ts`
- Create: `lib/linked-computers/run-queue-store.ts`
- Create: `app/api/v1/linked-computers/[deviceId]/runs/claim/route.ts`
- Create: `app/api/v1/linked-computers/[deviceId]/runs/[jobId]/progress/route.ts`
- Create: `app/api/v1/linked-computers/[deviceId]/runs/[jobId]/complete/route.ts`
- Modify: `app/api/v1/workspaces/route.ts`
- Modify: `app/api/v1/conversations/route.ts`
- Modify: `lib/agents/team.ts`
- Modify: `app/api/v1/conversations/[convId]/messages/route.ts`
- Create: `__tests__/api/linked-computer-dispatch.test.ts`

- [ ] Write failing tests proving only owned/shared org-granted fresh devices appear, guessed IDs fail, membership loss blocks dispatch, missing mappings fail, and explicit devices never fall back.
- [ ] Run the suite and confirm failures.
- [ ] Implement discovery and dispatch authorization from device/grant/mapping records; retain existing platform VPS and operator-local targets behind explicit compatibility adapters.
- [ ] Encrypt authorised work into the platform-owned per-device queue; claim atomically revalidates tenancy and uses short lease/attempt/token fencing.
- [ ] Require signed acceptance/progress/completion receipts to match the exact job, request, device, credential, mapping, attempt, lease token, body digests, and registered machine identity.
- [ ] Prove stale workers cannot complete reclaimed jobs, duplicate callbacks are idempotent, terminal results are redacted, and explicit offline devices never fall back.
- [ ] Re-run dispatch tests plus Stage 1 runtime/message suites and confirm pass.
- [ ] Commit with `feat(devices): authorize linked computer dispatch`.

### Task 5: Linked Computers settings and Messages UX

**Files:**
- Create: `app/(portal)/portal/settings/linked-computers/page.tsx`
- Create: `components/linked-computers/LinkedComputersWorkspace.tsx`
- Create: `components/linked-computers/PairComputerDialog.tsx`
- Modify: portal settings navigation component located with `rg 'API keys|Sessions' app/'(portal)' components`
- Modify: `components/chat/UnifiedChat.tsx`
- Create: `__tests__/components/linked-computers/LinkedComputersWorkspace.test.tsx`
- Modify: `__tests__/components/chat/UnifiedChat.context.test.tsx`

- [ ] Write failing tests for pair/name/grant/map/rotate/pause/revoke/remove flows, health/version/mapping status, precise error copy, and actual accepted-device badges.
- [ ] Run the UI suites and confirm failures.
- [ ] Implement accessible settings and Messages UI using safe APIs; never render raw paths or credentials, and do not claim an unavailable selected device was replaced.
- [ ] Re-run UI suites and confirm pass.
- [ ] Commit with `feat(devices): add linked computers product experience`.

### Task 6: macOS and Windows runtime installer foundations

**Files:**
- Create: `runtime-installers/macos/install.sh`
- Create: `runtime-installers/macos/com.partnersinbiz.runtime.plist`
- Create: `runtime-installers/windows/install.ps1`
- Create: `runtime-installers/windows/PartnersInBizRuntime.xml`
- Create: `runtime-installers/README.md`
- Create: `scripts/verify-linked-runtime-installers.ts`
- Create: `__tests__/scripts/verify-linked-runtime-installers.test.ts`

- [ ] Write failing static/command-construction tests proving install commands contain only pairing challenge identifiers, use OS secure credential storage, create background services, support update/rollback/uninstall, and never embed permanent keys.
- [ ] Run the verifier tests and confirm failures.
- [ ] Implement idempotent installer foundations, service definitions, secure storage hooks (Keychain and Windows Credential Manager), signed-update metadata verification hooks, rollback/uninstall commands, and explicit unsigned-development labeling.
- [ ] Re-run verifier tests, `bash -n` for macOS scripts, and PowerShell parser validation where available.
- [ ] Commit with `feat(devices): add macOS and Windows runtime installers`.

### Task 7: Integrated security and release verification

**Files:**
- Create: `docs/deploy/linked-computers-runbook.md`
- Modify: `firestore.indexes.json` only for verified query needs.

- [ ] Run all linked-computer, Workspace, runtime, and conversation-policy suites.
- [ ] Run typecheck, lint ratchet, targeted ESLint, index validation, `git diff --check`, and production build sequentially.
- [ ] Run two-user/two-org emulator acceptance proving cross-tenant denial, pairing replay denial, membership-loss denial, rotation/revocation, offline no-fallback, and redaction.
- [ ] Verify outbound queue claim/progress/completion, lease renewal/reclaim fencing, signed callbacks, encrypted payload storage, replay nonces, and TTL policy declarations.
- [ ] Prove pairing and heartbeat reject legacy endpoint/token fields, remove the direct transport adapter, and run the legacy transport cleanup in dry-run mode before any explicitly approved apply.
- [ ] Document installer signing/notarisation and production credentials as explicit release gates; do not claim those gates passed without artifacts.
- [ ] Commit the runbook/evidence contract with `docs(devices): add linked computer operations runbook`.
