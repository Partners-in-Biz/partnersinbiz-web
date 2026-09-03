import fs from 'node:fs'
import { createHash, X509Certificate } from 'node:crypto'
import { validatePowerShellStructure } from '@/scripts/verify-linked-runtime-installers'

const read = (file: string) => fs.readFileSync(file, 'utf8')

describe('internal Windows staff runtime channel', () => {
  it('pins the committed code-signing certificate exactly', () => {
    const encoded = read('runtime-installers/windows/internal-signing-public.cer.base64').trim()
    const certificate = new X509Certificate(Buffer.from(encoded, 'base64'))
    const fingerprint = createHash('sha256').update(certificate.raw).digest('hex').toUpperCase()
    expect(fingerprint).toBe('F40112CCB174A9FF5B7F56388D66BBA9CC98D9655C817B66B5F0A3D5A4DB7042')
    expect(certificate.subject).toContain('CN=The Partners in Business (PTY) LTD')
    expect(certificate.keyUsage).toContain('1.3.6.1.5.5.7.3.3')
  })

  it('requires explicit staff intent before modifying machine trust', () => {
    const bootstrap = read('public/runtime/bootstrap/windows.ps1')
    expect(validatePowerShellStructure(bootstrap)).toBeNull()
    expect(bootstrap).toMatch(/\[switch\]\$InternalStaff/)
    expect(bootstrap).toMatch(/\[switch\]\$ConfirmInternalTrust/)
    expect(bootstrap).toMatch(/if \(-not \$ConfirmInternalTrust\)/)
    expect(bootstrap).toMatch(/@\('Root','TrustedPublisher'\)/)
    expect(bootstrap).toMatch(/certutil\.exe -f -addstore \$StoreName \$CertificatePath/)
    expect(bootstrap).toMatch(/Cert:\\LocalMachine\\\$StoreName/)
    expect(bootstrap).toMatch(/Assert-InternalCertificate \$Signature\.SignerCertificate/)
    expect(bootstrap).not.toMatch(/InternalStaff[\s\S]{0,200}AllowUnsignedDev/)
    expect(bootstrap).toMatch(/-Action Pair -ChallengeId \$ChallengeId -ReleaseChannel \$\(if \(\$InternalStaff\) \{ 'internal' \} else \{ 'stable' \}\)/)
  })

  it('forwards the staff channel through pairing handoff into pair --channel', () => {
    const installer = read('runtime-installers/windows/install.ps1')
    const service = read('runtime-installers/windows/PartnersInBizRuntimeService.cs')
    expect(installer).toMatch(/\[ValidateSet\('internal','stable'\)\] \[string\]\$ReleaseChannel = 'stable'/)
    expect(installer).toMatch(/releaseChannel=\$channel/)
    expect(service).toMatch(/handoff\.releaseChannel=="internal"\?"internal":"stable"/)
    expect(service).toMatch(/pair --challenge "\+handoff\.challengeId\+" --channel "\+channel/)
    expect(service).toMatch(/public string releaseChannel\{get;set;\}/)
  })

  it('keeps internal releases isolated from the future public channel', () => {
    const workflow = read('.github/workflows/release-linked-runtime-windows-internal.yml')
    expect(workflow).toMatch(/runtime-internal-v\$env:VERSION/)
    expect(workflow).toMatch(/--prerelease/)
    expect(workflow).toMatch(/PIB_WINDOWS_INTERNAL_SIGNING_PFX_BASE64/)
    expect(workflow).toMatch(/PIB_WINDOWS_INTERNAL_RELEASE_PRIVATE_KEY_BASE64/)
    expect(workflow).toMatch(/FromBase64String\(\$env:RUNTIME_RELEASE_PRIVATE_KEY_BASE64\)/)
    expect(workflow).toMatch(/EXPECTED_CERT_SHA256/)
    expect(workflow).toMatch(/Get-AuthenticodeSignature/)
    expect(workflow).toMatch(/\$PSNativeCommandUseErrorActionPreference = \$false/)
    expect(workflow).toMatch(/\$InternalReleaseExitCode = \$LASTEXITCODE/)
    expect(workflow).toMatch(/\$global:LASTEXITCODE = 0/)
    expect(workflow).toMatch(/Windows Kits\\10\\bin\\\*\\x64\\signtool\.exe/)
    expect(workflow).not.toMatch(/Get-ChildItem[^\r\n]+-Recurse/)
    expect(workflow).toMatch(/\$ExpectedPrivateRoot = \$Signature\.Status -eq 'UnknownError'/)
    expect(workflow).toMatch(/0x800B0109/)
    expect(workflow).toMatch(/\$TamperedSignature\.Status -ne 'HashMismatch'/)
    expect(workflow).not.toMatch(/Cert:\\CurrentUser/)
    expect(workflow).not.toMatch(/X509Store]::new\(\$StoreName/)
    expect(workflow).not.toMatch(/Import-Certificate/)
    expect(workflow).toMatch(/name: Prepare and pin internal signing identity\n\s+timeout-minutes: 2/)
    expect(workflow).not.toMatch(/name: Install temporary verification/)
    expect(workflow).toMatch(/name: Locate bounded Windows signing tool\n\s+timeout-minutes: 2/)
    expect(workflow).not.toMatch(/sslcom|ESIGNER/i)
  })
})
