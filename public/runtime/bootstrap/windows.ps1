[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]{1,128}$')][string]$ChallengeId,
  [ValidatePattern('^[a-z][a-z0-9-]{0,31}(,[a-z][a-z0-9-]{0,31}){0,7}$')][string]$Profiles = 'pip',
  [ValidatePattern('^[a-z][a-z0-9-]{0,31}(,[a-z][a-z0-9-]{0,31}){0,5}$')][string]$Providers = 'nous',
  [switch]$InternalStaff,
  [switch]$ConfirmInternalTrust
)
$ErrorActionPreference = 'Stop'
$ApiBase = if ($env:PIB_API_BASE) { $env:PIB_API_BASE.TrimEnd('/') } else { 'https://partnersinbiz.online' }
$PublicReleaseBase = 'https://github.com/Partners-in-Biz/partnersinbiz-web/releases/latest/download'
$InternalReleaseBase = 'https://github.com/Partners-in-Biz/partnersinbiz-web/releases/download/runtime-internal-v1.1.30'
$ReleaseBase = if ($env:PIB_RUNTIME_RELEASE_BASE) { $env:PIB_RUNTIME_RELEASE_BASE.TrimEnd('/') } elseif ($InternalStaff) { $InternalReleaseBase } else { $PublicReleaseBase }
$Architecture = $env:PROCESSOR_ARCHITECTURE.ToLowerInvariant().Replace('amd64','x64')
$ExpectedPublisher = if ($env:PIB_WINDOWS_EXPECTED_PUBLISHER) { $env:PIB_WINDOWS_EXPECTED_PUBLISHER } else { 'The Partners in Business (PTY) LTD' }
$InternalCertificateSha256 = 'F40112CCB174A9FF5B7F56388D66BBA9CC98D9655C817B66B5F0A3D5A4DB7042'

function Assert-Administrator {
  $Principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this setup from an Administrator PowerShell.'
  }
}

function Get-CertificateSha256([Security.Cryptography.X509Certificates.X509Certificate2]$Certificate) {
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($Hasher.ComputeHash($Certificate.RawData))).Replace('-','') }
  finally { $Hasher.Dispose() }
}

function Assert-InternalCertificate([Security.Cryptography.X509Certificates.X509Certificate2]$Certificate) {
  $Fingerprint = Get-CertificateSha256 $Certificate
  if ($Fingerprint -cne $InternalCertificateSha256) { throw 'The PiB internal signing certificate fingerprint does not match the pinned staff certificate.' }
  $Publisher = $Certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($Publisher -cne $ExpectedPublisher) { throw "The PiB internal signing certificate has an unexpected publisher: $Publisher." }
  if ($Certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow.AddDays(30)) { throw 'The PiB internal signing certificate is expired or too close to expiry.' }
  $CodeSigningOid = '1.3.6.1.5.5.7.3.3'
  $HasCodeSigning = $false
  foreach ($Extension in $Certificate.Extensions) {
    if ($Extension -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
      foreach ($Usage in $Extension.EnhancedKeyUsages) { if ($Usage.Value -eq $CodeSigningOid) { $HasCodeSigning = $true } }
    }
  }
  if (-not $HasCodeSigning) { throw 'The pinned PiB internal certificate is not restricted to code signing.' }
}

function Install-InternalStaffTrust([string]$Stage) {
  Assert-Administrator
  if (-not $ConfirmInternalTrust) {
    throw 'Internal staff setup adds the pinned PiB certificate to this managed computer. Rerun with -ConfirmInternalTrust only on a Partners in Biz staff computer.'
  }
  $CertificatePath = Join-Path $Stage 'partnersinbiz-internal-windows-signing.cer'
  $CertificateUrl = "$InternalReleaseBase/partnersinbiz-internal-windows-signing.cer"
  Invoke-WebRequest -UseBasicParsing -Uri $CertificateUrl -OutFile $CertificatePath
  $Certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($CertificatePath)
  Assert-InternalCertificate $Certificate
  Write-Warning 'INTERNAL STAFF CHANNEL: trusting the pinned Partners in Biz certificate on this managed Windows computer.'
  foreach ($StoreName in @('Root','TrustedPublisher')) {
    & certutil.exe -f -addstore $StoreName $CertificatePath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Windows could not install the PiB certificate in LocalMachine/$StoreName." }
    $Installed = Get-ChildItem "Cert:\LocalMachine\$StoreName" |
      Where-Object { (Get-CertificateSha256 $_) -ceq $InternalCertificateSha256 } |
      Select-Object -First 1
    if (-not $Installed) { throw "The pinned PiB certificate is missing from LocalMachine/$StoreName after installation." }
  }
}

function Assert-ExpectedPublisher([string]$Path) {
  $Signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($Signature.Status -ne 'Valid' -or -not $Signature.SignerCertificate) {
    throw "The PiB Windows installer signature is not valid: $($Signature.Status)."
  }
  $Publisher = $Signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($Publisher -cne $ExpectedPublisher) {
    throw "The PiB Windows installer has an unexpected publisher: $Publisher."
  }
  if ($InternalStaff) { Assert-InternalCertificate $Signature.SignerCertificate }
}

if (-not (Get-Command hermes -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing Hermes Agent...'
  Invoke-Expression (Invoke-RestMethod 'https://hermes-agent.nousresearch.com/install.ps1')
  $env:Path = "$env:USERPROFILE\.local\bin;$env:USERPROFILE\.hermes\bin;$env:Path"
}
if (-not (Get-Command hermes -ErrorAction SilentlyContinue)) { throw 'Hermes installed, but its command is not on PATH. Open a new PowerShell and rerun this command.' }

$RequestedProfiles = $Profiles.Split(',')
$RequestedProviders = $Providers.Split(',')
foreach ($Profile in $RequestedProfiles) {
  $ProfileHome = Join-Path $env:USERPROFILE ".hermes\profiles\$Profile"
  if (-not (Test-Path $ProfileHome)) { & hermes profile create $Profile --description "Partners in Biz $Profile agent" }
  Write-Host "Configure the model for $Profile. Requested providers: $($RequestedProviders -join ', ')"
  & hermes -p $Profile setup model
  & hermes -p $Profile gateway install
  & hermes -p $Profile gateway start
}

$Stage = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $Stage | Out-Null
try {
  if ($InternalStaff) { Install-InternalStaffTrust $Stage }
  $BundleUrl = if ($env:PIB_RUNTIME_BUNDLE_URL) { $env:PIB_RUNTIME_BUNDLE_URL } else { "$ReleaseBase/partnersinbiz-runtime-windows-$Architecture-installer.cab" }
  $Archive = Join-Path $Stage 'runtime.cab'
  Write-Host $(if ($InternalStaff) { 'Installing the pinned internal Partners in Biz runtime...' } else { 'Installing the publicly signed Partners in Biz runtime...' })
  Invoke-WebRequest -UseBasicParsing -Uri $BundleUrl -OutFile $Archive
  Assert-ExpectedPublisher $Archive
  $Runtime = Join-Path $Stage 'runtime'; New-Item -ItemType Directory $Runtime | Out-Null
  & expand.exe $Archive -F:* $Runtime | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'The signed PiB runtime bundle could not be expanded.' }
  $RequiredExecutables = @('pib-runtime.exe','pib-release-manager.exe','pib-credential-helper.exe','PartnersInBizRuntimeService.exe')
  foreach ($Name in $RequiredExecutables) {
    $Executable = Join-Path $Runtime $Name
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "The signed PiB runtime bundle is missing $Name." }
    Assert-ExpectedPublisher $Executable
  }
  $Installer = Join-Path $Runtime 'install.ps1'
  if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'The signed PiB runtime bundle is incomplete.' }
  [void][scriptblock]::Create((Get-Content -LiteralPath $Installer -Raw))
  & $Installer -Action Install
  & $Installer -Action Pair -ChallengeId $ChallengeId
  Write-Host 'Computer linked. Keep Hermes and the PiB runtime running to stay available.'
} finally { Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue }
