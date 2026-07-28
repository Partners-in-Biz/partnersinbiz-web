# Partners in Biz linked runtime installers

This directory includes the TypeScript `pib-runtime` source, cryptographic core, native credential helpers, a per-user macOS LaunchAgent, a Windows SCM service wrapper, and a headless Linux systemd package for VPS hosts. The service is outbound-only: it heartbeats and polls fixed PiB HTTPS queue endpoints, signs every claim/progress/completion request, and calls loopback Hermes without opening an inbound listener. Pairing commands contain only `challengeId` and `platform`; the runtime privately prompts without terminal echo for the one-time code. It creates the Ed25519 device signing key locally and stores the private key and device credential in macOS Keychain, Windows Credential Manager, or a Linux host-key-encrypted `systemd-creds` file.

Hermes Agent is a hard prerequisite. The public bootstrap commands under `public/runtime/bootstrap/` install the official Hermes distribution on macOS, Windows, or Linux when it is missing, create the user-selected profiles, run Hermes' local model setup for each profile, install/start their gateways, then install and pair the signed PiB runtime. Provider API keys are entered only in Hermes' local setup; the browser handoff carries only the opaque challenge ID plus nonsecret profile/provider names.

Runtime protocol `1.1.11` adds signed custom-agent profile delivery (`SOUL.md` plus tenant-owned profile metadata) for organisation/member-created agents. Runtime `1.1.10` added authorised company-root Workbench file/folder search for safe chat mentions. It retains the `1.1.9` limit of eight concurrent linked chats on one computer, so a long-running agent no longer blocks new runs for other conversations or profiles. It preserves the `1.1.8` agent-host v2 readiness reporting (`hermes_binary_missing` vs unhealthy profiles), empty skill-pack stamps, concrete local Hermes failure details, and the longer rolling-restart claim window. Protocol `1.1.4` probes the configured loopback Hermes routes before a pairing code is consumed and refuses to pair when no agent is healthy. Each heartbeat repeats that probe, advertises only the healthy agent IDs, and removes `workspace.execute` while Hermes is unavailable. PiB therefore never labels a computer chat-ready merely because the lightweight runtime process is alive. Its idle execution claim loop remains inside the web acceptance window, so an online computer cannot miss new chat work merely because polling previously backed off too far. Version 1.1.4 also carries authorised chat images as short-lived native multimodal inputs instead of presenting authenticated website attachment paths as local files.

The runtime automatically discovers the default Hermes gateway plus named profiles under `~/.hermes/profiles`, reading each local `API_SERVER_PORT` and `API_SERVER_KEY` at call time without copying keys into PiB state. A same-named explicit profile wins over the global gateway, preventing PiB from silently inheriting a personal gateway's approval policy. The public bootstrap always creates a dedicated named Pip profile for the same reason. Windows may set `PIB_HERMES_HOME` so the LocalSystem runtime can locate the linked user's Hermes home. A computer can host agents that do not exist on the VPS. `PIB_LOCAL_HERMES_ROUTES` remains an explicit advanced override:

```text
PIB_LOCAL_HERMES_ROUTES={"pip":{"baseUrl":"http://127.0.0.1:8755","apiKey":"..."},"theo":{"baseUrl":"http://127.0.0.1:8756","apiKey":"..."}}
```

Route URLs are restricted to loopback HTTP. The runtime includes the selected `agentId` in the claimed job, dispatches only to that agent's configured route, and reports the healthy inventory to PiB so Messages never offers a computer for an agent it does not have.

Production metadata names `version`, `minimumVersion`, `payloadUrl`, `sha256`, and an Ed25519 `signature`. Install/update verifies authenticated metadata and payload before activation, enforces the minimum version, and retains one prior verified binary for rollback. Missing or invalid signatures fail closed. Immutable release assets live in the repository's `runtime-v<semver>` GitHub Releases; bootstrap scripts resolve the latest stable release, while each signed manifest pins its payload to the exact versioned tag.

The release private key is stored in GitHub Actions as `LINKED_RUNTIME_RELEASE_PRIVATE_KEY` and in Peet's macOS Keychain under `com.partnersinbiz.runtime-release-signing-key`. Only `runtime-installers/release-public.pem` is committed or distributed. Linux, macOS, and Windows release workflows build only from `main` and refuse mismatched signing keys, invalid SemVer, non-production source branches, or replacement of existing immutable platform assets.

## UNSIGNED DEVELOPMENT MODE

Unsigned packages are never silently accepted. macOS requires `PIB_ALLOW_UNSIGNED_DEV=1`; Windows requires `-AllowUnsignedDev`, and both print a prominent warning. This mode is development-only. macOS packages are Developer ID signed and notarised. Windows production uses an Authenticode-signed CAB: the bootstrap validates the CAB publisher before extraction and then validates every executable again. Updates additionally require the Ed25519 manifest signature and payload checksum. Those OS and release trust gates are independent and may not be bypassed.

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
