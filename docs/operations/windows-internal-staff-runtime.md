# Internal Windows linked runtime for Partners in Biz staff

## Scope

This is a temporary, zero-license-cost Windows channel for computers managed by Peet or Partners in Biz staff. It must never be offered as the public/customer Windows download.

The channel uses three independent checks:

1. A dedicated internal Authenticode certificate signs the CAB and every executable.
2. The bootstrap pins SHA-256 fingerprint `F40112CCB174A9FF5B7F56388D66BBA9CC98D9655C817B66B5F0A3D5A4DB7042` before adding the public certificate to the managed machine's Root and TrustedPublisher stores.
3. The normal PiB Ed25519 release signature binds runtime metadata to the exact payload hash and immutable internal release tag.

The private PFX exists only in GitHub Actions encrypted secrets. The public certificate is committed as base64 DER and published with each internal Windows release.

## Release

The internal workflow is `.github/workflows/release-linked-runtime-windows-internal.yml`. It must run from `main`, requires an existing public `runtime-v<version>` source release, and creates a separate prerelease tag `runtime-internal-v<version>`.

The unattended release runner does not mutate its Root store. It accepts `Valid`, or only the specific Windows untrusted-private-root result (`0x800B0109`), and always requires the exact signer publisher and SHA-256 certificate fingerprint. It also flips a byte in a copied signed executable and requires Windows to return `HashMismatch`, proving the verifier fails closed on tampering. Any unsigned, changed, unsupported, differently signed, or differently failing artifact blocks publication. Persistent machine-wide root and publisher trust is installed only during the explicit staff bootstrap below.

Required GitHub secrets:

- `PIB_WINDOWS_INTERNAL_SIGNING_PFX_BASE64`
- `PIB_WINDOWS_INTERNAL_SIGNING_PFX_PASSWORD`
- `PIB_WINDOWS_INTERNAL_RELEASE_PRIVATE_KEY_BASE64` (the existing Ed25519 release key encoded as a single line for reliable Windows secret transport)

## Staff installation

1. In PiB, create a one-time Windows pairing challenge but do not enable the general Windows download.
2. On the staff computer, open PowerShell as Administrator.
3. Run the normal bootstrap with the two explicit internal switches:

```powershell
& ([scriptblock]::Create((irm https://partnersinbiz.online/runtime/bootstrap/windows.ps1))) -ChallengeId 'CHALLENGE_ID' -Profiles 'pip' -Providers 'nous' -InternalStaff -ConfirmInternalTrust
```

The setup warns before adding trust, verifies the pinned certificate, installs/configures Hermes, verifies the CAB and all executable signatures, installs the Windows Service, and asks privately for the one-time code.

## Acceptance

- `Get-Service PartnersInBizRuntime` is `Running` with automatic startup.
- The installed runtime reports version `1.1.30` and paired status.
- PiB production reports the Windows device `active`, `health=ok`, `workspace.execute`, and the expected agent inventory.
- Reboot, runtime-process termination, Windows service-wrapper termination, temporary internet loss, update, rollback, and Credential Manager persistence pass on clean Windows 11 x64 and arm64 machines. The service manager must show restart actions at 5, 10, and 30 seconds.

## Public transition

For customer distribution, replace this channel with either a Microsoft Store MSIX path or a CA-trusted Authenticode release. Do not reuse the internal root, and do not make public verification accept self-signed publishers.
