# Partners in Biz linked runtime installers

This directory includes the TypeScript `pib-runtime` source, cryptographic core, native credential helpers, a per-user macOS LaunchAgent, and a buildable Windows SCM service wrapper. It pairs with a one-time browser challenge and keeps a loopback bridge connected to local Hermes. Pairing commands contain only `challengeId` and `platform`; the runtime privately prompts for the one-time code. It creates the Ed25519 device signing key locally and stores the private key, device credential, and transport token in macOS Keychain or Windows Credential Manager. Heartbeats bootstrap transport and every accepted execution produces a canonical signed execution receipt.

Production metadata names `version`, `minimumVersion`, `payloadUrl`, `sha256`, and an Ed25519 `signature`. Install/update verifies authenticated metadata and payload before activation, enforces the minimum version, and retains one prior verified binary for rollback. Missing or invalid signatures fail closed.

## UNSIGNED DEVELOPMENT MODE

Unsigned packages are never silently accepted. macOS requires `PIB_ALLOW_UNSIGNED_DEV=1`; Windows requires `-AllowUnsignedDev`, and both print a prominent warning. This mode is development-only. A production release remains blocked until the macOS package is Developer ID signed and notarised and the Windows installer/binary is Authenticode signed, with real release public keys configured.

Lifecycle commands are idempotent: `install`, `pair`, `update`, `rollback`, `revoke`, and `uninstall`. Revocation is attempted with a signed device request before local credentials are deleted; uninstall then removes the service and files. A device already revoked server-side can still be safely removed locally.

Safe browser handoffs:

```text
pib-runtime pair --challenge <challengeId> --platform macos
pib-runtime pair --challenge <challengeId> --platform windows
```

Build shared source with `runtime-installers/build-runtime.sh`. Packaging still needs release-owned compilation of the native helpers/service, architecture fixtures, and signing.
