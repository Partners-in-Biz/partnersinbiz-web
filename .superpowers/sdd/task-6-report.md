# Stage 2 Task 6 Report — Linked runtime installer foundations

Date: 2026-07-13
Branch: `development`
Status: implementation and focused verification complete; production signing gates remain open.

## Commit

- `a4491290` — `feat(devices): add macOS and Windows runtime installers`

## Delivered contract

- Browser/runtime handoffs contain only `challengeId` and `platform`; pairing codes are prompted privately.
- The runtime payload contract creates and proves the device key, exchanges the one-time challenge, stores device/transport/signing credentials in macOS Keychain or Windows Credential Manager, sends signed heartbeat bootstrap requests, bridges to local Hermes, and emits signed execution receipts.
- macOS launchd and Windows startup Scheduled Task definitions provide restartable background execution.
- Install/update authenticates metadata and payload before activation, enforces `minimumVersion`, preserves one previous binary, and exposes rollback.
- Revoke sends a signed request before secure local credential deletion; uninstall removes credentials, service registration, and installation files.
- Unsigned development mode is explicitly labelled and opt-in. Production packages fail closed when signing configuration is absent.

## Red-green evidence

RED:

```text
npx jest __tests__/scripts/verify-linked-runtime-installers.test.ts --runInBand
FAIL: expected verifier exit 0, received 1 (verifier/assets did not exist)
```

GREEN:

```text
npx jest __tests__/scripts/verify-linked-runtime-installers.test.ts --runInBand
PASS: 1 suite, 1 test

npx tsx scripts/verify-linked-runtime-installers.ts
Linked runtime installer verification passed

bash -n runtime-installers/macos/install.sh
PASS

git diff --check -- runtime-installers scripts/verify-linked-runtime-installers.ts __tests__/scripts/verify-linked-runtime-installers.test.ts
PASS
```

PowerShell Core (`pwsh`) is unavailable on this Mac, so native PowerShell AST parser validation was skipped. The focused verifier statically checks the Windows lifecycle/service/credential/signature contract.

## Remaining production blockers

- Build and publish the architecture-specific `pib-runtime` payload implementing the documented command contract.
- Configure and protect the real release signing keys and pinned Windows signer thumbprint.
- Developer ID sign and notarise the macOS package/runtime.
- Authenticode sign the Windows catalog, installer, and runtime binary.
- Run native macOS package and Windows VM end-to-end pairing, heartbeat, execution-receipt, update, minimum-version, rollback, revoke, and uninstall drills.
- Production release approval remains required; no Preview or production deployment was triggered.

## Scope hygiene

The unrelated dirty `.superpowers/sdd/task-3-report.md` was not staged, edited, or committed. No other concurrent work was included.

## Review remediation (2026-07-13)

Commit `021f20eb` replaces comments-only runtime claims with executable TypeScript cryptographic/bridge source, a macOS Keychain helper, Windows Credential Manager helper source, per-user LaunchAgent configuration, and a buildable Windows SCM service wrapper. Negative tests now exercise bad signature, hash, architecture, minimum-version, secret redaction, canonical receipt signing, and offline revoke cleanup. Focused result: 2 suites / 4 tests passed; verifier CLI and both Bash syntax checks passed. Native PowerShell, Swift, and Windows builds remain unavailable on this Mac.

Important remaining integration blockers: the Windows service-mediated pairing handoff/identity path and complete native Credential Manager read path still require Windows implementation/testing; rollback metadata persistence/re-verification and atomic replacement are not yet fully implemented in installers; end-to-end package fixtures/signing drills remain open. These are not claimed complete.

## Final remediation (2026-07-13)

Commit `bf153184` closes the remaining source-level findings: Windows LocalSystem owns DPAPI handoff claim/decrypt/erase and Credential Manager CredRead/CredWrite; installer handoff is SecureString prompted, DPAPI LocalMachine protected, SYSTEM/Administrators ACL restricted, and atomically renamed. Both update paths verify signed metadata, platform/architecture/version/minimumVersion/hash before activation, retain the signed previous bundle, atomically rename releases, and reverify before rollback. Missing previous refuses safely without affecting uninstall. The checked-in Ed25519 fixture and mutations exercise signature/hash/architecture/minimum-version failures. The deterministic PowerShell fallback rejects unterminated strings and unbalanced braces when `pwsh` is absent.

Final focused evidence: 2 suites / 7 tests passed; verifier CLI passed; both Bash syntax checks passed; scoped TypeScript (`--skipLibCheck`) passed; targeted ESLint passed; scoped diff check passed. Remaining gates are external artifacts only: macOS Developer ID/notarisation, Windows Authenticode/catalog production signing, and native macOS/Windows VM lifecycle drills. No production signing or VM evidence is claimed.

## Direct HTTPS transport blocker (2026-07-13)

The follow-up requirement for a working controlled-host outbound tunnel cannot be completed from repository source alone. The repository defines no tunnel provider, controlled hostname, device tunnel credential provisioning/rotation/revoke protocol, tunnel client package coordinates/hash/pinned signing key, or production `LINKED_RUNTIME_ALLOWED_HOSTS` value. The server deliberately rejects endpoints when that allowlist is absent or when DNS is not globally routable (`lib/linked-computers/transport.ts`). Test-only example hostnames are not deployable infrastructure. An arbitrary quick-tunnel hostname would fail closed and violate the controlled-host requirement. Required external input is a named provider/domain plus credential lifecycle and signed client distribution metadata. No generic process-wrapper scaffold is being represented as a working tunnel.

## Outbound queue and release lifecycle completion (2026-07-13)

The runtime no longer exposes an unauthenticated inbound HTTP listener or depends on a tunnel/transport-token normal flow. `pib-runtime service` now heartbeats and polls fixed PiB HTTPS queue endpoints, signs every claim/progress/completion request with the device credential, Ed25519 private key, timestamp, and fresh request nonce, resolves work only through the private local mapping registry, and calls loopback Hermes directly. Pairing prompts without terminal echo; map/unmap/status persist atomically at mode `0600`; revoke always clears the OS credential store even when remote revoke is offline.

Both installers now invoke the shared release-manager verifier. It validates canonical Ed25519 manifests, strict semver, channel, platform, architecture, minimum version, downgrade policy, and payload hash. Rollback re-verifies the signed prior bundle and permits only that explicit downgrade path. macOS uses the per-user LaunchAgent, Keychain helper, private rotated logs, and atomic version directories. Windows uses the SCM service under LocalSystem, same-identity Credential Manager helper, DPAPI LocalMachine pairing handoff, restricted ACL, atomic release directories, and waits for `SERVICE_STOPPED` before replacement. The build script emits source packages containing runtime, release manager, credential helper, installer, and service source for macOS arm64/x64 and Windows arm64/x64.

Verification: 4 focused suites / 14 tests passed; runtime TypeScript passed; installer verifier passed; Bash syntax passed; all four package-matrix artifacts were produced locally. The deterministic PowerShell lexer now covers comments, escaped and doubled quotes, here-strings, parentheses, brackets, and braces. External gates remain production Developer ID/notarisation and Authenticode/catalog signing, plus native Windows VM/.NET SDK/PowerShell lifecycle drills; no native Windows or production-signing proof is claimed.

## Final runtime reviewer remediation (2026-07-13)

Long Hermes executions now send signed acceptance and periodic signed progress/lease-renewal receipts every ten seconds, well below the server lease, and always clear the renewal timer. Receipts retain attempt and lease-token fencing. Strict SemVer 2 parsing handles prerelease precedence and rejects leading-zero numeric identifiers. Update baseline detection verifies the installed signed manifest, signature, and payload before using its version; minimum-version bootstrap is used only when no current install exists. Rollback is offline-only against the stored prior signature, and Windows stops and waits for `SERVICE_STOPPED` before swapping.

The Windows SCM host now supervises the worker, detects exits, restarts with bounded backoff, restarts after a successful DPAPI pairing handoff, and shuts down cleanly. Credential Manager memory uses exact UTF-8 byte allocation, exact-span zeroing, `FreeHGlobal` in `finally`, and safe `CredFree`. Service create/config and exit checks are idempotent. Unsigned development mode is explicitly forwarded through the release manager while retaining platform, architecture, channel, semver, minimum-version, and hash checks. Outbound identity storage discards legacy transport tokens.

Verification is green: 4 suites / 16 tests, full repository typecheck, runtime typecheck, targeted ESLint, Bash syntax, verifier, and diff check. Bun successfully compiled standalone runtime and release-manager executables for all four targets; Swift compiled both macOS credential helpers. Packaging then failed clearly at the unavoidable native Windows boundary because this Mac has a .NET host but no installed SDK. Windows service/helper source and cross-publish commands are complete, but native Windows binaries and VM behavior remain external gates along with production signing/notarisation.

## Rotation, renewal race, and unsigned lifecycle closeout (2026-07-13)

Heartbeat handling now consumes the real `data.rotation` shape exactly once, atomically replaces credential/version in the OS secure-store identity while preserving device ID/private key, and explicitly discards legacy transport tokens. The next signed request is proven to use the rotated version. Lease renewal is serialized, tracks its in-flight promise, clears the timer, and awaits a delayed renewal before terminal submission so completion cannot race the server fence.

macOS uses `manifest.sig` as the sole stored signature name. Rollback reads only that offline file and never fetches a current remote signature. Explicit unsigned development install/update/rollback uses a `.unsigned-dev` marker; production refuses that marker, and signed mode never copies a missing signature. Windows applies the same current/previous marker contract and `AllowUnsignedDev` gate. An executable shell lifecycle harness exercises signed, explicitly unsigned, production-refusal, and canonical offline signature transitions; PowerShell lifecycle remains covered by the strengthened structural parser on this Mac because native `pwsh` is unavailable.

Final verification: 4 suites / 19 tests, full repository typecheck, runtime typecheck, targeted ESLint, three Bash syntax checks, installer verifier, and diff check all pass. External blockers are unchanged: .NET SDK/native Windows VM validation and production signing/notarisation.

## Two-phase credential rotation completion (2026-07-13)

The runtime now treats `data.rotation` as an at-least-once delivery with stable `rotationDeliveryId`. It sanitizes every identity load, migrates legacy transport tokens out of secure storage, atomically writes the new credential/version plus pending delivery ID, reads it back, and only then signs the rotation acknowledgement using the new credential/version and a fresh request ID. A pending acknowledgement survives restart and is retried before the next heartbeat; repeated delivery is idempotent. Successful acknowledgement clears the pending marker durably. Errors and logs never include credential material.

Tests simulate failed writes, torn-write/crash readback, failed acknowledgement and retry, repeated delivery, legacy-token migration, one-time application, and proof that the next signed request uses the new credential version. Final verification: 4 suites / 22 tests, full repository typecheck, runtime typecheck, targeted ESLint, Bash syntax/lifecycle harness, installer verifier, and diff check all pass.

## Atomic macOS Keychain replacement (2026-07-13)

Keychain credential writes now update the existing generic-password item with `SecItemUpdate`, preserving its service/account/access attributes. Only `errSecItemNotFound` falls back to `SecItemAdd`; there is no delete-before-add credential-loss window. The helper reads the item back and compares the exact data before reporting success. Source regression coverage rejects delete/add replacement and requires update, not-found fallback, and readback. The Swift helper compiles successfully. Final focused result: 4 suites / 23 tests, full typecheck, runtime typecheck, verifier, and diff check pass.

## Transport removal, signed revoke, and mapping confirmation (2026-07-13)

Pairing and heartbeat no longer send `bootstrapTransport` or use transport tokens; the runtime is outbound queue-only. Device revoke now uses an exact signed device-auth route, atomically removes the device credential and access, pauses/removes mappings and grants, and cancels outstanding jobs. Runtime revoke writes a nonsecret `0600` pending marker before the remote attempt, retries with the credential while available, guarantees local secure-store cleanup, and reports pending remote cleanup safely.

Workspace mapping creation now returns a server-generated logical ID in `pending` state. The portal shows a path-free, platform-specific local command; the folder is entered only on the computer. `pib-runtime map` writes the canonical local mapping before signed confirmation activates it, while `unmap` confirms pause. Runtime discovery and dispatch continue to require `active`, excluding pending mappings. Relevant API, UI, dispatch, runtime and installer verification is green: 10 suites / 61 tests, full typecheck, targeted ESLint, Bash syntax, verifier and diff check.

## Offline revoke recovery (2026-07-13)

A failed remote revoke no longer deletes the only signing identity. The runtime writes a nonsecret `0600` pending marker and retains the credential/private key in OS secure storage. Service startup checks that marker before any heartbeat or claim and enters a serialized signed revoke-only retry loop with bounded backoff. Server acknowledgement or an idempotent already-revoked response clears both marker and identity; no job processing is possible while pending. Default uninstall retains the minimal runtime/service and identity for recovery. Force-local removal is explicit, loudly warns that portal revocation is still required, and preserves the nonsecret marker.

Tests prove offline revoke retains identity, retry survives restart, the recovery path invokes only revoke, and success clears state. Focused runtime/installer result: 3 suites / 21 tests, full typecheck, runtime typecheck, targeted ESLint, Bash syntax, verifier and diff check pass.

## Exact revoke acknowledgement (2026-07-13)

Secure identity deletion now requires an HTTP success response whose parsed body is exactly allowlisted by meaning: `revoked: true` and code `device_revoked` or `already_revoked`. Generic 401/403/410 responses, malformed JSON, network errors, replay/signature/clock failures, and unknown codes remain pending and retain the identity. The signed route returns the explicit `device_revoked` acknowledgement alongside safe cleanup progress. Tests cover both allowed codes and every ambiguous status/body class. Focused result: 2 suites / 19 tests, full and runtime typecheck, verifier and diff check pass.
