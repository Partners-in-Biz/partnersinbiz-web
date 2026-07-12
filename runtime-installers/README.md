# Partners in Biz linked runtime installers

These foundations install an architecture-specific `pib-runtime` payload, pair it with a one-time browser challenge, and keep a background bridge connected to local Hermes. Pairing commands contain only `challengeId` and `platform`; the runtime privately prompts for the one-time code. It creates the device signing key locally and stores the private key, device credential, and transport token in macOS Keychain or Windows Credential Manager. Heartbeats bootstrap transport and every accepted execution produces a signed execution receipt.

Production metadata names `version`, `minimumVersion`, `payloadUrl`, `sha256`, and an Ed25519 `signature`. Install/update verifies authenticated metadata and payload before activation, enforces the minimum version, and retains one prior verified binary for rollback. Missing or invalid signatures fail closed.

## UNSIGNED DEVELOPMENT MODE

Unsigned packages are never silently accepted. macOS requires `PIB_ALLOW_UNSIGNED_DEV=1`; Windows requires `-AllowUnsignedDev`, and both print a prominent warning. This mode is development-only. A production release remains blocked until the macOS package is Developer ID signed and notarised and the Windows installer/binary is Authenticode signed, with real release public keys configured.

Lifecycle commands are idempotent: `install`, `pair`, `update`, `rollback`, `revoke`, and `uninstall`. Revocation is attempted with a signed device request before local credentials are deleted; uninstall then removes the service and files. A device already revoked server-side can still be safely removed locally.

Safe browser handoffs:

```text
pib-runtime pair --challenge <challengeId> --platform macos
pib-runtime pair --challenge <challengeId> --platform windows
```

The runtime payload contract must implement `pair`, `bridge`, `verify-update`, `enforce-minimum-version`, `revoke`, and credential deletion. No secret may be accepted through command arguments or logged.
