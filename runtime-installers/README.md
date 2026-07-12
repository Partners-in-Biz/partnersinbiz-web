# Partners in Biz linked runtime installers

This directory includes the TypeScript `pib-runtime` source, cryptographic core, native credential helpers, a per-user macOS LaunchAgent, and a buildable Windows SCM service wrapper. The service is outbound-only: it heartbeats and polls fixed PiB HTTPS queue endpoints, signs every claim/progress/completion request, and calls loopback Hermes without opening an inbound listener. Pairing commands contain only `challengeId` and `platform`; the runtime privately prompts without terminal echo for the one-time code. It creates the Ed25519 device signing key locally and stores the private key and device credential in macOS Keychain or Windows Credential Manager.

Production metadata names `version`, `minimumVersion`, `payloadUrl`, `sha256`, and an Ed25519 `signature`. Install/update verifies authenticated metadata and payload before activation, enforces the minimum version, and retains one prior verified binary for rollback. Missing or invalid signatures fail closed.

## UNSIGNED DEVELOPMENT MODE

Unsigned packages are never silently accepted. macOS requires `PIB_ALLOW_UNSIGNED_DEV=1`; Windows requires `-AllowUnsignedDev`, and both print a prominent warning. This mode is development-only. A production release remains blocked until the macOS package is Developer ID signed and notarised and the Windows installer/binary is Authenticode signed, with real release public keys configured.

Lifecycle commands are idempotent: `install`, `pair`, `update`, `rollback`, `revoke`, and `uninstall`. Revocation is attempted with a signed device request before local credentials are deleted; uninstall then removes the service and files. A device already revoked server-side can still be safely removed locally.

Safe browser handoffs:

```text
pib-runtime pair --challenge <challengeId> --platform macos
pib-runtime pair --challenge <challengeId> --platform windows
```

Folder mappings are local-only and private: use `pib-runtime map --mapping <id> --folder <absolute folder>`, `unmap`, and `status`. The registry is atomically written with mode `0600`, and runtime resolution rejects symlink escapes.

Build with `runtime-installers/build-runtime.sh`. Bun compiles standalone runtime and release-manager executables for macOS arm64/x64 and Windows arm64/x64, Swift compiles the macOS helpers, and the .NET SDK cross-publishes the Windows SCM service and Credential Manager helper. The build fails clearly instead of emitting source-only packages when the native toolchain is absent. Production packaging still needs release signing and native VM drills.
