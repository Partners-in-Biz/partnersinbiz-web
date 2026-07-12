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
