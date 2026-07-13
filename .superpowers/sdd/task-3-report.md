# Stage 2 Task 3 report: Linked computer lifecycle APIs

## Status

Complete. Source commit: `5a5ab0cc4d5017328e8aba0b410b1b23041589c4` (`feat(devices): add grants mappings and credential lifecycle`).

## Red evidence

Command:

`npm test -- --runInBand __tests__/api/linked-computer-lifecycle.test.ts`

Initial result: 1 suite failed, 2 tests failed because `rotateDeviceCredential` and `revokeDeviceCredential` did not exist. This established the credential overlap and immediate-revocation boundary before implementation.

## Green evidence

Commands and results:

- `npm test -- --runInBand __tests__/api/linked-computer-lifecycle.test.ts __tests__/api/linked-computer-pairing.test.ts __tests__/api/linked-computer-pairing-http.test.ts __tests__/lib/linked-computers/store.test.ts` — 4 suites passed, 48 tests passed.
- `npm run typecheck` — passed with no diagnostics.
- Scoped ESLint across all Task 3 production files — passed with no warnings or errors.
- `git diff --check` — passed.

## Implementation

- Added authenticated user list/update, organisation grant, owner mapping, rotation, revoke/remove, and signed-device heartbeat APIs.
- Heartbeat authentication signs the exact raw method/path/timestamp/request ID/body tuple and consumes the central replay nonce before parsing the payload.
- Added a strict browser-safe device DTO. Responses omit runtime target IDs, public-key material/fingerprints, raw paths, credentials, internal URLs, and SSH details.
- Reused central owner, active-membership, organisation-admin, tenant, grant, canonical Workspace, and mapping transition policies.
- Added server-timestamped heartbeat freshness and allowlisted runtime/capability/health persistence.
- Added five-minute server-controlled credential rotation overlap. Only the immediately prior version is accepted during overlap; expired versions fail. Revocation clears overlap material immediately.
- Device removal revokes credentials and terminally removes mappings/revokes grants in the same transaction.
- Tests cover safe DTO redaction, route-bound actor/device identity, grant and mapping allowlists, exact raw-body heartbeat authentication, cross-device denial, rotation overlap/expiry, immediate revocation, and the Task 1 membership/cross-tenant/status lifecycle suite.

## Self-review

- User-controlled device IDs in request bodies cannot override route IDs.
- Grant authority and owner membership are checked in the transactional store, not trusted from API role labels.
- Device-facing heartbeat is not wrapped in browser auth; it requires scoped credential, version, Ed25519 signature, timestamp window, and one-time request nonce.
- Rotation returns the new credential exactly once under `no-store`; stored credential material remains hashed.
- No raw local path from heartbeat or mapping bodies is persisted or returned.
- Existing pairing/auth tests remain green, including replay and future-skew nonce retention.

## Concerns

- The lifecycle suite uses deterministic Firestore-compatible fakes; emulator-backed multi-user/multi-organisation acceptance remains a programme-level release gate.
- List discovery currently returns owner-managed devices. Explicitly shared-device discovery is deliberately left to the dispatch/discovery policy slice so it can revalidate current membership and active grants at selection time.
- No production deployment or promotion was performed.

## Stage 2 review fix: ownership, containment, and cascade audit closure

Commit: `c5b8c5f570541b8a66d25f6a61af0695edb0be79` (`fix(devices): enforce lifecycle ownership and cascade audits`).

### Red evidence

`npm test -- --runInBand __tests__/lib/linked-computers/store.test.ts`

Result before the fix: 1 suite failed, 3 tests failed, 18 passed. The failures proved that a shared user could mutate an owner mapping, an administrator could not pause an existing grant after owner membership loss, and removal did not emit credential/grant/mapping cascade audits.

### Green evidence

- Linked-computer verification: 4 suites passed, 55 tests passed.
- `npm run typecheck`: passed with no diagnostics.
- Scoped ESLint across all Task 3 production files: passed with no warnings or errors.
- `git diff --check`: passed.

### Review closure

- Mapping create/update/pause/resume/remove is now device-owner-only. Explicitly shared users remain consumers for the later dispatch slice and cannot administer mappings.
- An active grant still requires current owner membership. A current same-organisation administrator may pause or revoke an existing grant after owner membership loss, but cannot create or reactivate access.
- Device removal atomically revokes the credential, grants, and mappings and emits a credential audit plus one audit per affected grant and mapping, alongside the device transition audit.
- The route/store matrix covers list/update, grant active/pause/revoke, owner-only mapping/shared denial, device pause/resume/revoke, remove cascade, membership loss, cross-tenant denial, rotation overlap/old-version denial/revocation, and signed heartbeat.
- Collection `POST` is intentionally absent and tested as absent. Secure device creation remains exclusively in the one-time pairing exchange.

## Final coverage closure: real store-backed lifecycle routes

Commit: `52fa8b41514e6ebe0319e75b2de5a14a9d0988a4` (`test(devices): cover store-backed lifecycle routes`).

### Red/green evidence

The new DELETE boundary test initially failed with HTTP 400 because the route handler could not inject the store-backed removal operation. After adding the same narrow dependency seam used by the other lifecycle handlers, the real `removeOwnedDevice` transaction ran through the route-bound owner identity and passed.

Final verification:

- Linked-computer verification: 4 suites passed, 61 tests passed.
- `npm run typecheck`: passed with no diagnostics.
- Scoped ESLint: passed with no warnings or errors.
- `git diff --check`: passed.

### Added coverage

- `listOwnedDevices` filters out another owner's device and returns only the safe DTO.
- `updateOwnedDevice` persists the owner label while ignoring injected path and credential fields.
- `recordDeviceHeartbeat` uses the server-controlled timestamp for both freshness fields, ignores caller time, and denies paused devices.
- Mapping owner denial is exercised for active creation plus paused and removed transitions.
- `handleLinkedComputerRemove` drives the real store transaction with the route device and authenticated owner, proving device removal, credential revocation, grant revocation, and mapping removal.
- A forced cascade audit write failure proves the transaction rolls back every device, credential, grant, and mapping mutation.
