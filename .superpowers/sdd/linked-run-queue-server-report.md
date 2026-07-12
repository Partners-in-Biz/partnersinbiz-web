# Linked run queue server report

Date: 2026-07-13
Scope: server-side outbound linked-device run queue (no `runtime-installers/**` changes)

## Outcome

- Linked Messages dispatch no longer depends on a public device endpoint or outbound transport token.
- PiB reauthorizes the linked device, encrypts prompt/model/provider at rest with per-device/per-job AES-256-GCM context, and appends a deterministic job to a per-device queue document.
- Signed device-auth claim atomically selects the oldest queued job, supports expired-lease reclaim, and returns only logical IDs, relative folder, and decrypted execution input. It never returns a physical path, endpoint, credential, or token.
- Signed progress and completion callbacks bind the exact device, job, request, mapping, credential version, attempt, lease, and Ed25519 receipt.
- Completion is idempotent and updates the queued job, assistant message, and run ledger. A retry repairs message/ledger finalization if the first post-transaction finalizer is interrupted.
- Dispatch waits for a bounded signed claim. Timeout cancels the encrypted job, persists `linked_device_claim_timeout`, and never falls back.
- Terminal and expired jobs clear encrypted payloads. `cleanupAt` has a Firestore TTL field override.

## TDD evidence

RED:

- `__tests__/lib/linked-computers/run-queue.test.ts` initially failed because `run-queue` did not exist.
- `__tests__/api/linked-computer-run-queue.test.ts` initially failed because claim/progress/complete routes did not exist.
- Duplicate-completion test then failed with `linked computers: run already final` before idempotency was implemented.

GREEN:

- Focused linked queue/domain/routing suites: 6 suites, 71 tests passed, 0 skipped.
- TypeScript project typecheck passed.
- Targeted production ESLint passed with no errors (test files are repository-ignored and reported warnings only when explicitly named).
- `git diff --check` and `firestore.indexes.json` parse passed.

## Security notes

- Queue discovery uses `linked_device_run_queues/{deviceId}.pendingJobIds`; it does not issue a broad cross-device job query.
- The deterministic job ID is SHA-256 over device ID and request ID, preventing duplicate dispatch from creating two jobs.
- Claim and callback routes reuse replay-protected signed device authentication.
- Callback receipts are separately Ed25519-signed and checked against the paired device public key.
- Compatibility runtime targets remain on the existing path; only linked-computer dispatch uses the outbound queue.

## Remaining operational gates

- Deploy the Firestore TTL override before relying on automatic physical deletion. Payload ciphertext is cleared synchronously at terminal/expiry regardless.
- Emulator-backed concurrency should remain part of release acceptance; focused tests cover transition and HTTP contracts, while production Firestore transaction semantics are enforced by the implementation.

## Commit

Recorded in the Git commit containing this report (`feat(devices): add secure outbound run queue`).
