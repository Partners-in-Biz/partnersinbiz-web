# Partners in Biz linked runtime installers

This directory includes the TypeScript `pib-runtime` source, cryptographic core, native credential helpers, a per-user macOS LaunchAgent, a Windows SCM service wrapper, and a headless Linux systemd package for VPS hosts. The service is outbound-only: it heartbeats and polls fixed PiB HTTPS queue endpoints, signs every claim/progress/completion request, and calls loopback Hermes without opening an inbound listener. Pairing commands contain only `challengeId` and `platform`; the runtime privately prompts without terminal echo for the one-time code. It creates the Ed25519 device signing key locally and stores the private key and device credential in macOS Keychain, Windows Credential Manager, or a Linux host-key-encrypted `systemd-creds` file.

Production metadata names `version`, `minimumVersion`, `payloadUrl`, `sha256`, and an Ed25519 `signature`. Install/update verifies authenticated metadata and payload before activation, enforces the minimum version, and retains one prior verified binary for rollback. Missing or invalid signatures fail closed.

## UNSIGNED DEVELOPMENT MODE

Unsigned packages are never silently accepted. macOS requires `PIB_ALLOW_UNSIGNED_DEV=1`; Windows requires `-AllowUnsignedDev`, and both print a prominent warning. This mode is development-only. A production release remains blocked until the macOS package is Developer ID signed and notarised and the Windows installer/binary is Authenticode signed, with real release public keys configured.

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

Set `PIB_RUNTIME_UPDATE_PUBLIC_KEY` to the production Ed25519 release public key, then run the signed lifecycle as root:

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
