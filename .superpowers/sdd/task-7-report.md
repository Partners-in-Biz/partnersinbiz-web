# Stage 2 Task 7 Report: Integrated Linked Computers Verification

Date: 2026-07-13
Branch: `development`
Baseline HEAD: `3d92af2cc7eff2959c14092ddb57ff4f412bb546`
Baseline remote: `origin/development` at `9430c9a36fa6dba8d4364cb6e95b1d838eec6f60`
Task 7 source commit: `c32c335283aba92cd638bef7245f34b4647c9e02` (`docs(devices): verify linked computer release gates`)

## Status

Fresh final integrated source verification passed on 2026-07-13: 27 suites/297 tests, full typecheck, quality ratchet (`explicitAny=714`, `emptyCatch=198`), and the production build (308/308 static pages). External acceptance gates explicitly listed below remain unpassed: Firebase emulator/isolated-project tenancy, native Windows packaging/VM lifecycle, native signed/notarised macOS lifecycle, production Firestore TTL deployment/readback, real-device `pwd`, signing, rollback, and production approval. No production deployment, Firestore index/TTL deployment, production signing, or production promotion was performed.

## Architecture and operations deliverables

- Updated the approved design and implementation plan from direct public device endpoint/tunnel transport to a platform-owned encrypted outbound run queue.
- Added `docs/deploy/linked-computers-runbook.md` covering pairing, device/grant/mapping lifecycle, queue leases and callbacks, rotation, secure stores, installer build/signing, TTL/index policy, rollback/revoke, incident debugging, and explicit external gates.
- Added `__tests__/acceptance/linked-computers-two-tenant.test.ts`, using deterministic read fakes and mocked route handlers only. It covers the integrated policy contract for two users/two organisations, cross-tenant denial, pairing replay, owner membership loss, revoke/stale explicit-device no-fallback, rotation acknowledgement, browser redaction, and outbound queue claim/progress/completion. It is not emulator evidence; focused store and real route-handler suites provide the source-level transaction/route coverage.

## Source finding fixed with TDD

Index validation found that pairing challenges used an ISO string `expiresAt` and had no TTL field override. Firestore TTL requires a timestamp field.

RED:

```text
npx jest __tests__/api/linked-computer-pairing.test.ts __tests__/lib/linked-computers/store.test.ts --runInBand
Test Suites: 2 failed
Tests: 2 failed, 45 passed, 47 total
```

GREEN:

```text
npx jest __tests__/api/linked-computer-pairing.test.ts __tests__/lib/linked-computers/store.test.ts --runInBand
Test Suites: 2 passed, 2 total
Tests: 47 passed, 47 total
```

Both pairing creation paths now persist `cleanupAt` as a Firestore `Timestamp`, while retaining protocol-facing ISO `expiresAt`. `firestore.indexes.json` declares TTL on `linked_device_pairing_challenges.cleanupAt`.

The lint ratchet initially reported `explicitAny: 717 > 716`. `apiErrorFromException` was safely changed from `any` to narrowed `unknown`; the ratchet then passed at 716.

## Exact final verification

### Integrated acceptance

```text
npx jest __tests__/acceptance/linked-computers-two-tenant.test.ts --runInBand
Test Suites: 1 passed, 1 total
Tests: 3 passed, 3 total
```

### Linked computers, Workspace, runtime and conversation policy

```text
npx jest --runInBand __tests__/acceptance/linked-computers-two-tenant.test.ts __tests__/api/linked-computer-dispatch.test.ts __tests__/api/linked-computer-lifecycle.test.ts __tests__/api/linked-computer-pairing-http.test.ts __tests__/api/linked-computer-pairing.test.ts __tests__/api/linked-computer-run-queue.test.ts __tests__/lib/linked-computers/run-queue.test.ts __tests__/lib/linked-computers/store.test.ts __tests__/components/linked-computers/LinkedComputersWorkspace.test.tsx __tests__/scripts/linked-runtime-bridge.test.ts __tests__/scripts/linked-runtime-core.test.ts __tests__/scripts/linked-runtime-worker.test.ts __tests__/scripts/verify-linked-runtime-installers.test.ts __tests__/api/conversations-platform.test.ts __tests__/api/conversation-messages-routing.test.ts __tests__/api/conversation-route-policy-matrix.test.ts __tests__/api/conversation-mutation-routes.test.ts __tests__/api/conversation-agent-messages.test.ts __tests__/api/conversation-finalize.test.ts __tests__/api/conversation-context.test.ts __tests__/api/conversation-attachments.test.ts __tests__/api/conversation-access-management.test.ts __tests__/lib/agents/runtime-targets.test.ts __tests__/lib/agents/runtime-config.test.ts __tests__/lib/client-provisioning/working-directory.test.ts __tests__/lib/workspaces/dispatch-errors.test.ts __tests__/lib/conversations/access.test.ts __tests__/lib/conversations/participant-access.test.ts __tests__/components/chat/UnifiedChat.context.test.tsx
Test Suites: 29 passed, 29 total
Tests: 321 passed, 321 total
```

### TypeScript, quality, ESLint, indexes and diff

```text
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --pretty false --project tsconfig.typecheck.json
PASS (exit 0, no diagnostics)

npm run lint:ratchet
Quality ratchet passed: {"explicitAny":716,"emptyCatch":198}

npx eslint --max-warnings=0 --no-warn-ignored lib/api/response.ts lib/linked-computers app/api/v1/linked-computers components/linked-computers runtime-installers/runtime scripts/verify-linked-runtime-installers.ts __tests__/acceptance/linked-computers-two-tenant.test.ts __tests__/api/linked-computer-pairing.test.ts __tests__/lib/linked-computers/store.test.ts
PASS (exit 0, zero warnings/errors)

node -e "const f=require('fs'); const j=JSON.parse(f.readFileSync('firestore.indexes.json','utf8')); const ttl=new Map((j.fieldOverrides||[]).filter(x=>x.ttl).map(x=>[x.collectionGroup+':'+x.fieldPath,true])); for(const k of ['linked_device_pairing_challenges:cleanupAt','linked_device_rotation_deliveries:cleanupAt','linked_device_run_jobs:cleanupAt','linked_device_request_nonces:expiresAt']) if(!ttl.has(k)) throw new Error('missing TTL '+k); console.log('Firestore JSON valid; required linked-computer TTL policies declared:', 4)"
Firestore JSON valid; required linked-computer TTL policies declared: 4

git diff --check
PASS (exit 0)
```

### Runtime and installer foundations

```text
npx jest __tests__/scripts/linked-runtime-bridge.test.ts __tests__/scripts/linked-runtime-core.test.ts __tests__/scripts/linked-runtime-worker.test.ts __tests__/scripts/verify-linked-runtime-installers.test.ts --runInBand
Test Suites: 4 passed, 4 total
Tests: 23 passed, 23 total

npx tsc -p runtime-installers/runtime/tsconfig.json
PASS

npx tsx scripts/verify-linked-runtime-installers.ts
Linked runtime installer verification passed

bash -n runtime-installers/macos/install.sh
bash -n runtime-installers/build-runtime.sh
bash -n runtime-installers/tests/macos-lifecycle.sh
PASS

bash runtime-installers/tests/macos-lifecycle.sh
PASS; explicitly exercised unsigned-development marker behavior
```

`bash runtime-installers/build-runtime.sh` compiled standalone runtime and release-manager executables for macOS arm64/x64 and Windows arm64/x64, and Swift compiled both macOS credential helpers. It then exited 1 at the intentional native boundary:

```text
Windows native helper/service packaging blocked: install a .NET SDK, then rerun this build.
```

`pwsh` is not installed. `/usr/local/share/dotnet/dotnet` exists, but `dotnet --list-sdks` returns no SDK. The deterministic PowerShell parser/verifier passed; native Windows parsing/build/VM behavior is not claimed.

### Production build

```text
npm run build
PASS (exit 0)
Next.js 16.2.9 webpack production build compiled successfully in 3.4 minutes.
Static generation: 308/308 pages.
```

## External gates and blockers

- Install a .NET SDK, publish the Windows x64/arm64 helper and SCM service, then execute native Windows VM lifecycle tests with PowerShell.
- Developer ID sign, notarise/staple, install and lifecycle-test macOS arm64/x64 packages.
- Authenticode/catalog sign and lifecycle-test Windows arm64/x64 packages.
- Protect and use real production release-signing keys and publish architecture-specific packages.
- Run Firebase emulator or approved isolated-project two-user/two-org acceptance. No emulator configuration/tooling was available in this checkout, so deterministic Firestore-compatible fakes were used.
- Explicitly approve and deploy Firestore TTL/index policy, then read it back from the production project. Checked-in JSON is not deployed proof.
- Retain real macOS and Windows organisation/project `pwd`, update/rollback/revoke/uninstall, audit/redaction and rollback-drill artifacts.
- Explicit production approval is required before merge/promotion to `main` or `vercel --prod`.

## Scope hygiene

- `.superpowers/sdd/task-3-report.md` was a pre-existing unrelated dirty file and was not staged or modified by Task 7.
- Generated `runtime-installers/dist/` artifacts were removed after verification and are not committed.
- No production or Preview deployment was triggered.

## Review rejection remediation: remove legacy inbound transport

Follow-up source commit: `10d45b583c883a174b8723e14c5fd50b63adb62c` (`fix(devices): remove legacy inbound runtime transport`).

The review found a real architecture contradiction: outbound queue dispatch was canonical, but pairing/heartbeat and a server adapter still allowed legacy direct inbound transport registration. The remediation removes that path fully from normal source:

- pairing rejects `runtimeEndpoint`, `bootstrapTransport`, and `transportToken`, never reads/writes `linked_device_runtime_transports`, and returns only device ID, credential, and credential version;
- heartbeat rejects the same legacy fields, never binds/updates an endpoint, and never returns a transport token;
- the direct transport adapter, DNS/allowlist logic, and `LINKED_RUNTIME_ALLOWED_HOSTS` source path were deleted;
- device pause/revoke/remove no longer reads or mutates legacy transport rows;
- rotation credential encryption moved to the transport-neutral `secret-envelope` module;
- conversation routing tests no longer mock the deleted adapter and continue to prove the platform queue is the sole linked-computer dispatch path.

TDD evidence:

```text
npx jest __tests__/api/linked-computer-pairing.test.ts --runInBand
RED: 1 failed, 20 passed; legacy runtimeEndpoint input still resolved successfully.

npx jest __tests__/api/linked-computer-pairing.test.ts __tests__/api/linked-computer-pairing-http.test.ts __tests__/api/linked-computer-lifecycle.test.ts __tests__/api/linked-computer-dispatch.test.ts __tests__/api/conversation-messages-routing.test.ts __tests__/scripts/cleanup-linked-runtime-transports.test.ts --runInBand
GREEN: 6 suites passed, 72 tests passed.
```

Added `scripts/cleanup-linked-runtime-transports.ts` and 2 focused tests. It is dry-run by default, supports optional `--device-id`, requires explicit `--apply`, batches writes, deletes only the legacy transport collection and allowlisted legacy fields, and emits a counts-only audit. It never outputs stored values. No apply was run.

Final follow-up verification:

```text
Focused linked/Workspace/runtime/conversation matrix: 31 suites passed, 323 tests passed.
8 GB TypeScript: pass, no diagnostics.
Quality ratchet: explicitAny 716, emptyCatch 198.
Targeted ESLint: zero warnings/errors.
Firestore JSON/4 required TTL declarations: pass.
git diff --check: pass.
npm run build: pass; final fresh webpack build compiled in 4.5 minutes; 308/308 static pages generated.
```

## Operations evidence follow-up: recoverable cleanup apply

Follow-up commit: `ea745115cc97acd92fb8ff375a70fa342377f9fb` (`fix(devices): checkpoint legacy cleanup batches`).

Apply mode now creates `linked_computer_migration_runs/{runId}` in `running` state before any cleanup mutation. Each batch reserves two writes for an atomic counts-only audit and migration checkpoint alongside its source mutations. The checkpoint records batch index, cumulative counts, and remaining action count. Terminal state is `complete`; a caught batch failure records `failed`, the last committed checkpoint, cumulative counts, and a generic recovery message without stored values. Reusing the same run ID and scope resumes from current state and the prior checkpoint; a new run reconstructs remaining work. Completed run IDs are idempotent.

Focused failure/resume evidence:

```text
npx jest __tests__/scripts/cleanup-linked-runtime-transports.test.ts --runInBand
Test Suites: 1 passed, 1 total
Tests: 3 passed, 3 total
```

The failure test commits batch 1 with its atomic audit/checkpoint, forces batch 2 to fail without changing its source row, verifies durable `failed` state with cumulative batch-1 counts, then resumes the same run ID and verifies terminal completion and batch-2 audit. The test wording and assertions prove cleanup planning/checkpoints operate without emitting or logging secret values.

Supporting verification:

```text
npm run typecheck
PASS, no diagnostics

npx eslint --max-warnings=0 --no-warn-ignored scripts/cleanup-linked-runtime-transports.ts __tests__/scripts/cleanup-linked-runtime-transports.test.ts
PASS, zero warnings/errors

npm run lint:ratchet
Quality ratchet passed: {"explicitAny":716,"emptyCatch":198}

git diff --check
PASS
```

Actual connected-project dry-run, with no `--apply`:

```text
npx tsx --env-file=.env.local scripts/cleanup-linked-runtime-transports.ts
{"mode":"dry-run","scope":"all-linked-devices","transportDocuments":0,"documentsWithLegacyFields":0,"legacyFields":0}
```

The output contains only allowlisted mode/scope/count keys and numeric counts. No document IDs, endpoints, tokens, encrypted values, credentials, or other stored values were printed. No cleanup mutation or audit/run record was written in dry-run mode.
