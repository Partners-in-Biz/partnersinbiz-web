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

## Security review follow-up

The review hardening pass adds an unpredictable per-attempt lease token, running-job reclaim, strict old-worker fencing, and completion receipts that canonically sign outcome, timing, runtime identity, lease identity, and SHA-256 plus byte lengths for output/error. Completion bodies are verified before any write, terminal duplicates are immutable, and result text is redacted before reaching Messages or the run ledger.

Queue insertion now rejects backpressure before creating a job, creates the run ledger in the same transaction as the job/queue entry, and never drops live IDs by slicing. Claim revalidates the device, owner membership, grant capability, current credential, and exact active mapping before decryption. Signed acceptance is stored through the progress callback, and the dispatch waiter requires an acceptance or completion receipt rather than treating a bare claim as success.

Cancellation now transactionally checks non-terminal state, removes the queue ID, clears ciphertext, and finalizes job/message/ledger together. Completion also finalizes all three records in one transaction.

Follow-up verification: 37 focused tests passed and targeted production ESLint/diff checks passed. Full typecheck was blocked only by concurrent installer verifier changes using unsupported regex flags in `scripts/verify-linked-runtime-installers.ts`; no type errors were reported in this server slice.

## Final race and identity hardening

- Expired `running` work is reclaimable with a new random lease token and incremented attempt; signed progress renews only the current fenced lease.
- Timeout cancellation reports whether its transaction won. Messages writes timeout only on a winning cancellation and otherwise preserves the terminal result.
- Jobs retain the dispatch actor ID. Claim revalidates both actor and owner memberships plus owner/shared grant access before releasing plaintext.
- Receipt runtime version and machine label must equal the registered device values before accepted identity is persisted.
- Claim scans at most 12 candidate IDs per transaction, preserving the rest for later polls.
- Result sanitization now covers arbitrary POSIX, drive-letter and UNC paths, URLs, Authorization/Bearer credentials, named secrets, nested JSON secrets, and private-key material.

Final focused verification: 29 tests passed; targeted ESLint and diff checks passed. Full typecheck remains blocked solely by concurrent installer verifier regex flags outside this server slice.

## Final P2 hardening

- Bounded queue scans now preserve exact FIFO order: surviving head candidates remain ahead of the untouched tail.
- The first signed acceptance snapshots runtime version and machine label onto the job. Later progress/completion validates against that immutable accepted identity, so a legitimate device rename or upgrade after acceptance cannot invalidate the run.
- Redaction handles complete quoted JSON secret values, including spaces and escaped quotes, without leaking suffixes.

P2 verification: 29 focused tests passed; targeted ESLint and diff checks passed. Full typecheck remains blocked only by the concurrent installer verifier regex target issue.

## Two-phase credential rotation

Credential rotation delivery is now crash-safe and explicitly acknowledged. A previous-version heartbeat receives a stable `rotationDeliveryId`, the new credential and version, but no outbound transport token. Delivery records retain encrypted credential material through the overlap and record delivery timestamp/attempt count so an interrupted installation can request the same delivery again.

The signed rotation acknowledgment endpoint authenticates with the new credential/version, matches the device and delivery ID transactionally, clears ciphertext only after success, and is idempotent for the exact acknowledged delivery. Old credentials, wrong delivery IDs, expiry, revocation, and removal cannot retain or acknowledge pending ciphertext.

Rotation verification: 35 lifecycle/pairing tests passed; full TypeScript typecheck, targeted ESLint, and diff checks passed.

## Rotation cleanup hardening

Rotation deliveries now carry a Firestore `cleanupAt` TTL timestamp. Expiry clears ciphertext and marks the delivery terminal before TTL deletion. Every revoke/remove path—including ordinary status transitions, explicit credential revocation, and device removal—clears pending rotation ciphertext and invalidates the previous-credential overlap transactionally.

Acknowledgment now requires an active device, current version, unexpired delivery, live ciphertext, and a non-terminal state. Idempotent success is limited to the exact already-acknowledged delivery; cleared-but-unacknowledged or expired deliveries fail closed. Credential rotation is active-device-only and cannot start while paused.

Cleanup verification: 37 lifecycle/pairing tests passed; full typecheck, targeted ESLint, index JSON validation, and diff checks passed.

## Integrated security truth pass

- Previous overlap credentials are restricted to the explicit heartbeat rotation-delivery action; generic heartbeat and all other device APIs require the current credential.
- A current credential may continue a pre-rotation accepted job only when the stored acceptance predates credential issuance and the same registered device key signs the new-version receipt.
- Linked runtime versions use strict semantic-version parsing and a central minimum. Invalid/old runtimes are update-required and cannot dispatch; production fails closed when the minimum is absent.
- Accepted-device UI data is derived only from the verified stored acceptance receipt snapshot.
- Output is redacted before truncation, including unterminated PEM material, high-entropy tokens, paths, URLs, and credentials; uncertain remnants collapse to `[redacted output]` while signed hashes/lengths preserve integrity evidence.

## Final lifecycle cleanup pass

Emergency revoke/remove now performs only the bounded authority-kill transaction: terminal device state, revoked current/overlap credential, cleared rotation delivery, and a durable cleanup-run checkpoint. Mappings, grants, and jobs are processed later through resumable batches. Job cleanup uses the queue cancellation transaction so the queue ID, ciphertext, assistant message, and run ledger finalize together.

Signed mapping confirmation now delegates to the central transactional policy with exact device/mapping/workspace/organisation binding, active owner membership/grant/current credential checks, constrained transitions, terminal removal, and audit history.

Privacy redaction now covers database/auth assignment variants, arbitrary connection URIs with userinfo, quoted/escaped values, and percent-encoded credentials.

Prior Task 7 readiness evidence is invalidated by these lifecycle changes. Readiness can pass only after a fresh final integrated verification on the final source commit.

## Durable cleanup executor

Revoke/remove routes now kick one bounded cleanup batch after the authority-kill transaction and return HTTP 202 with an explicit cleanup state. Failures to kick do not roll back or delay credential invalidation.

The scheduled linked-device cleanup worker leases a bounded set of durable cleanup runs, fences concurrent workers, processes one bounded phase batch, checkpoints pending/completed state, and records a secret-free retryable failure with backoff. Vercel invokes it every five minutes through the established cron authorization convention.

Canonical Task 7 readiness remains invalidated. A fresh integrated verification must be appended only after the final source commit is stable.
