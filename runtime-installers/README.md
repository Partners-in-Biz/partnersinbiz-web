# Partners in Biz linked runtime installers

This directory includes the TypeScript `pib-runtime` source, cryptographic core, native credential helpers, a per-user macOS LaunchAgent, a Windows SCM service wrapper, and a headless Linux systemd package for VPS hosts. The service is outbound-only: it heartbeats and polls fixed PiB HTTPS queue endpoints, signs every claim/progress/completion request, and calls loopback Hermes without opening an inbound listener. Pairing commands contain only `challengeId` and `platform`; the runtime privately prompts without terminal echo for the one-time code. It creates the Ed25519 device signing key locally and stores the private key and device credential in macOS Keychain, Windows Credential Manager, or a Linux host-key-encrypted `systemd-creds` file.

Hermes Agent is a hard prerequisite. The public bootstrap commands under `public/runtime/bootstrap/` install the official Hermes distribution on macOS, Windows, or Linux when the binary is missing, then install and pair the signed PiB runtime with `--agents`. They do **not** create Hermes profiles, run local model setup, or start gateways. Partners in Biz provisions `{orgSlug}--{agentId}` managed profiles after pair. The browser handoff carries only the opaque challenge ID plus nonsecret agent / channel names.

## Managed profiles

PiB is the authority for organisation agents on a paired machine.

- Pairing sends `orgId` and the selected catalog agent ids. The runtime CLI is `pib-runtime pair --challenge <id> --platform <os> --agents pip,maya`.
- Desired-state jobs create the profile with `hermes profile create --no-skills`, write `pib-managed.json`, generate `API_SERVER_KEY` if missing, and apply skill packs / org credentials / browser policy.
- Heartbeat `availableProfiles` is grant-filtered into `availableAgents` (each row has `orgId`) plus `ignoredProfiles`. Unmanaged profiles with `orgId: null` are omitted from both. Organisation keys are delivered only to matching `orgId` rows.
- `executeAgentHostJob` refuses `org_mismatch` before any skill, credential, or browser work when the marker org disagrees with the job.
- Protocol version is `4`. Claim accepts 3 or 4; v3 runtimes skip `managedProfile` jobs and leave them queued.
- Workbench desktop sessions protocol is `2` (claim includes `driver`; runtime pauses agent input while `driver === 'user'`). Protocol `1` runtimes still work because the server gates agent driving controls.

## Hermes channel pin

`platform_config/linked_runtime_channels` plus signed `GET .../[deviceId]/runtime-config` tell each device the Hermes `minVersion` / `targetVersion` / `targetTag`. The first pin is `v2026.8.31` (Hermes 0.21.0). Facts live in `runtime-installers/runtime/hermes-contract.json`.

- Update strategy is the official installer: `curl …/install.sh | bash -s -- --branch {tag} --non-interactive`. The CLI cannot pin a tag. Do not run `hermes update --yes` as the pin path.
- `updatePausesGateways` is false on POSIX. The runtime stops Mac/Linux gateways before update.
- A failed update reports heartbeat `healthReason: hermes_update_failed` and keeps serving the previous checkout. Retry at most once per 6 hours.
- If the probed Hermes version is below `minVersion`, the claim loop advertises concurrency `0`. Heartbeat still runs. Unparseable versions fail open.

## Real-profile browsing

Owner-only. Settings: **Let agents on this computer browse as me** (pin / headed / Windows autoclose). The UI prints the spec §H.5 risk sentence.

- Contract keys: `browser.use_real_profile`, `real_profile_pin`, `headed`, `real_profile_autoclose`. Snapshot `{HERMES_HOME}/browser-profile/{browser}` is **shared** — delete it only when no remaining managed profile still has `use_real_profile: true`.
- Runtime fail-closes `real_profile_guard` when a non-owner (or missing actor/owner ids) would run against a real-profile-enabled profile. Chat copy: *This computer's owner has enabled browsing as themselves; your chat cannot run there.*
- Grant pause/revoke or consent off enqueues `useRealProfile: false`. OS keychain encryption of profile secrets is `UNVERIFIED` in the contract — skip enabling it.

## Windows workspace.sync

Windows runtimes advertise `nativeWorkspaceSyncSupported`. `workspace.sync` jobs apply on win32 the same way Linux applies native protocol `1`. Internal staff Windows pairing uses `--channel internal` / `-ReleaseChannel`; do not treat that channel as the public customer download.

## Hermes prerequisite release disposition

The bootstrap scripts currently install Hermes only when its executable is missing; they do not compare or update an existing Hermes version. A PiB runtime package alone therefore cannot deliver a Hermes-core resilience fix to managed Macs, VPS hosts, or public bootstrap users. The approved-release requirements and no-rollout disposition for the session-persistence resilience hardening are recorded in [Hermes session-persistence resilience release disposition](../docs/operations/hermes-session-persistence-release-disposition.md). Do not claim automatic receipt until a separately approved Hermes update path and signed runtime/installer release have been verified for macOS, Windows, and Linux.

Runtime protocol `1.1.23` distinguishes a normal accepted hand-off from a real capacity queue, so a newly accepted linked run is shown as starting rather than falsely claiming that capacity is exhausted. It reserves up to ten linked chats per healthy Hermes profile, with a safe host ceiling of 64. A saturated profile is skipped fairly so work for another healthy profile can continue. Credential, install, and policy refreshes now reload only the affected Hermes profile: Linux, Windows, and ordinary macOS runtimes use their own profile lifecycle, while a PiB-managed macOS fleet sends an acknowledged target-only restart request to its supervisor. If an older supervisor is still loaded, it safely falls back to that supervisor's existing single-child recovery path; it never boots out or force-restarts the whole fleet for one agent. Runtime protocol `1.1.22` makes a temporary PiB control-plane failure self-healing on every supported runtime package: signed heartbeats retry at 1s, 2s, 4s and then bounded exponential backoff (maximum 30s), returning to the normal cadence after the first success. The web keeps a run bound to the exact device while its local Hermes process is recovering; a true credential, grant, mapping, delegation, or membership revocation remains terminal. Runtime protocol `1.1.21` never hard-fails a chat on gateway/runtime upgrade blips or browser-tool CDP deaths: mid-poll reattachment, one automatic browser-tool retry, lease abandon for reclaim, and web auto-requeue for up to two recoverable failures. It also removes the same-agent execution lock. Every linked chat now has an independent Hermes run, approval namespace, tool context, and working directory. Capacity (`429`) and gateway drain (`503`) produce signed queued lease receipts and honor `Retry-After`; the runtime records the local Hermes run ID so a reclaimed lease can reattach after restart and creates a replacement only after an authenticated `404`. The web remains compatible with `1.1.19` and earlier acceptance receipts. Runtime protocol `1.1.13` adds owner-authenticated, machine/profile-bound LLM credential delivery and live provider canaries before chat readiness. Runtime protocol `1.1.12` auto-creates missing project relative folders (`projects/<projectId>`) under a linked mapping root on first resolve so link-only project locations accept chat runs without waiting for VPS provision/sync. Runtime protocol `1.1.11` adds signed custom-agent profile delivery (`SOUL.md` plus tenant-owned profile metadata) for organisation/member-created agents. Runtime `1.1.10` added authorised company-root Workbench file/folder search for safe chat mentions. It introduced the then-current 8-chat device limit. Protocol `1.1.4` probes the configured loopback Hermes routes before a pairing code is consumed and refuses to pair when no agent is healthy. Each heartbeat repeats that probe, advertises only the healthy agent IDs, and removes `workspace.execute` while Hermes is unavailable. PiB therefore never labels a computer chat-ready merely because the lightweight runtime process is alive.

The runtime automatically discovers the default Hermes gateway plus named profiles under `~/.hermes/profiles`, reading each local `API_SERVER_PORT` and `API_SERVER_KEY` at call time without copying keys into PiB state. A same-named explicit profile wins over the global gateway, preventing PiB from silently inheriting a personal gateway's approval policy. Managed org profiles are named `{orgSlug}--{agentId}` and created by PiB after pair, not by bootstrap. Windows may set `PIB_HERMES_HOME` so the LocalSystem runtime can locate the linked user's Hermes home. A computer can host agents that do not exist on the VPS. `PIB_LOCAL_HERMES_ROUTES` remains an explicit advanced override:

```text
PIB_LOCAL_HERMES_ROUTES={"pip":{"baseUrl":"http://127.0.0.1:8755","apiKey":"..."},"theo":{"baseUrl":"http://127.0.0.1:8756","apiKey":"..."}}
```

Route URLs are restricted to loopback HTTP. The runtime includes the selected `agentId` in the claimed job, dispatches only to that agent's configured route, and reports the healthy inventory to PiB so Messages never offers a computer for an agent it does not have.

## Long-running local Hermes work

Local Hermes runs have no wall-clock timeout by default: the runtime and watcher remain attached until Hermes completes, fails, or the run is explicitly cancelled. Set `PIB_LOCAL_HERMES_RUN_TIMEOUT_MS` (runtime) or `HERMES_RUN_TIMEOUT_MS` (watcher) to a positive millisecond value only when an operator needs a bounded run; unset or `0` means unlimited. Health heartbeats and the existing authenticated restart/recovery paths remain active while a run is in progress.

Production metadata names `version`, `minimumVersion`, `payloadUrl`, `sha256`, and an Ed25519 `signature`. Install/update verifies authenticated metadata and payload before activation, enforces the minimum version, and retains one prior verified binary for rollback. Missing or invalid signatures fail closed. Immutable release assets live in the repository's `runtime-v<semver>` GitHub Releases; bootstrap scripts resolve the latest stable release, while each signed manifest pins its payload to the exact versioned tag.

The release private key is stored in GitHub Actions as `LINKED_RUNTIME_RELEASE_PRIVATE_KEY` and in Peet's macOS Keychain under `com.partnersinbiz.runtime-release-signing-key`. Only `runtime-installers/release-public.pem` is committed or distributed. Linux, macOS, and Windows release workflows build only from `main` and refuse mismatched signing keys, invalid SemVer, non-production source branches, or replacement of existing immutable platform assets.

## UNSIGNED DEVELOPMENT MODE

Unsigned packages are never silently accepted. macOS requires `PIB_ALLOW_UNSIGNED_DEV=1`; Windows requires `-AllowUnsignedDev`, and both print a prominent warning. This mode is development-only. macOS packages are Developer ID signed and notarised. Windows production uses an Authenticode-signed CAB: the bootstrap validates the CAB publisher before extraction and then validates every executable again. Updates additionally require the Ed25519 manifest signature and payload checksum. Those OS and release trust gates are independent and may not be bypassed.

### Internal Windows staff channel

Until the public Windows CA-signing channel is funded, managed Partners in Biz staff computers may use the isolated `runtime-internal-v<semver>` prerelease channel. It is not unsigned development mode. Executables and CABs are Authenticode-signed with a dedicated PiB internal code-signing certificate, while runtime metadata and payload hashes retain the normal Ed25519 release signature. The bootstrap requires both `-InternalStaff` and `-ConfirmInternalTrust`, pins the certificate's SHA-256 fingerprint before importing it into the machine Root and TrustedPublisher stores, and then verifies the CAB plus every executable against the same certificate.

The internal certificate is intentionally not trusted by Windows globally. Never expose this channel as the public/customer Windows download, never ask a customer to install the PiB private trust root, and never weaken public publisher verification to accept it implicitly. A future Microsoft Store MSIX or public-CA Authenticode release continues on the existing production channel without changing the internal trust boundary.

## Windows package

Windows x64 and arm64 packages are flat CAB files containing the signed runtime, signed release manager, signed SCM service, signed Credential Manager helper, installer, release public key, and README. The expected Authenticode publisher is exactly `The Partners in Business (PTY) LTD`. The public bootstrap rejects an invalid or differently named publisher before extracting or executing package content. The installed updater repeats executable publisher validation and verifies the Ed25519 release manifest and SHA-256 before activation.

The production workflow is prepared for SSL.com eSigner cloud signing because modern publicly trusted code-signing private keys must remain in approved hardware-backed storage. It expects repository secrets `SSL_ESIGNER_USERNAME`, `SSL_ESIGNER_PASSWORD`, `SSL_ESIGNER_CREDENTIAL_ID`, and `SSL_ESIGNER_TOTP_SECRET`. The cloud action is commit-pinned, signs on a Windows runner, and publication remains impossible while any credential is absent or any signature/publisher check fails.

Lifecycle commands are idempotent: `install`, `pair`, `update`, `rollback`, `revoke`, and `uninstall`. Revocation is attempted with a signed device request before local credentials are deleted. If PiB is offline, the OS-secure identity and a nonsecret pending marker are retained and the service enters revoke-only retry mode: it cannot heartbeat, claim, or execute work. Uninstall likewise retains the minimal runtime until server acknowledgement. `--force-local` (macOS) or `-ForceLocal` (Windows) is an explicit last resort that prints a warning and requires revocation from the PiB portal.

Safe browser handoffs:

```text
pib-runtime pair --challenge <challengeId> --platform macos
pib-runtime pair --challenge <challengeId> --platform windows
pib-runtime pair --challenge <challengeId> --platform linux
```

Folder mappings are local-only and private: use `pib-runtime map --mapping <id> --folder <absolute folder>`, `unmap`, and `status`. The registry is atomically written with mode `0600`, and runtime resolution rejects symlink escapes.

## Linux VPS package

Linux packages target glibc x64 and arm64 with Bun's `bun-linux-x64` and `bun-linux-arm64` standalone targets. Each `partnersinbiz-runtime-linux-<arch>.tgz` contains `pib-runtime`, `pib-release-manager`, the installer, the systemd unit, and both Linux helpers. Build only those archives on macOS with:

```text
PIB_RUNTIME_TARGETS="linux-x64 linux-arm64" runtime-installers/build-runtime.sh
```

The host prerequisites are systemd 250 or newer (including `systemd-creds`), Python 3, curl, and a glibc Linux distribution. The installer intentionally runs the service as root because linked projects may live under different VPS users and because host-key decryption is root-only. Identity JSON is piped directly into `systemd-creds encrypt --with-key=host`; only authenticated ciphertext is stored under `/var/lib/partnersinbiz/credentials` with mode `0600`. `/var/lib/systemd/credential.secret` remains owned and managed by systemd. The package never writes plaintext identity JSON to disk.

Published installer bundles include the production Ed25519 public key. `PIB_RUNTIME_UPDATE_PUBLIC_KEY` remains available as an explicit override. Run the signed lifecycle as root:

```text
./install.sh install
./install.sh pair <challengeId>
./install.sh map <mappingId> /absolute/project/folder
./install.sh status
./install.sh update
./install.sh rollback
./install.sh revoke
./install.sh uninstall
```

Install, update, and rollback verify the signed manifest, platform, architecture, release channel, minimum version, and payload SHA-256 through the standalone release manager before activation. One verified prior release is retained. Revocation is signed with the paired device identity. If the server cannot acknowledge it, the encrypted identity and minimal runtime remain in revoke-only mode; `uninstall --force-local` is the explicit recovery escape hatch and requires portal revocation.

The systemd service advertises native workspace sync protocol version `1`. PiB must not lease native sync jobs to runtimes reporting another version. Sync apply operations use a separate descriptor-relative helper: approved parent directories are inherited as file descriptor 0, and create/remove/rename operations never reconstruct authority from a user-controlled absolute path. Target activation uses Linux `renameat2(RENAME_NOREPLACE)`.

Build the complete matrix with `runtime-installers/build-runtime.sh`. Bun compiles standalone runtime and release-manager executables for macOS arm64/x64, Windows arm64/x64, and Linux arm64/x64; Swift compiles the macOS helpers, and the .NET SDK cross-publishes the Windows SCM service and Credential Manager helper. The build fails clearly instead of emitting source-only packages when a selected native toolchain is absent. Production packaging still needs release signing and native Linux/Windows/macOS VM drills.
