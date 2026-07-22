[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]{1,128}$')][string]$ChallengeId,
  [ValidatePattern('^[a-z][a-z0-9-]{0,31}(,[a-z][a-z0-9-]{0,31}){0,7}$')][string]$Profiles = 'pip',
  [ValidatePattern('^[a-z][a-z0-9-]{0,31}(,[a-z][a-z0-9-]{0,31}){0,5}$')][string]$Providers = 'nous'
)
$ErrorActionPreference = 'Stop'
$ApiBase = if ($env:PIB_API_BASE) { $env:PIB_API_BASE.TrimEnd('/') } else { 'https://partnersinbiz.online' }
$ReleaseBase = if ($env:PIB_RUNTIME_RELEASE_BASE) { $env:PIB_RUNTIME_RELEASE_BASE.TrimEnd('/') } else { 'https://github.com/Partners-in-Biz/partnersinbiz-web/releases/latest/download' }
$Architecture = $env:PROCESSOR_ARCHITECTURE.ToLowerInvariant().Replace('amd64','x64')
$ExpectedPublisher = if ($env:PIB_WINDOWS_EXPECTED_PUBLISHER) { $env:PIB_WINDOWS_EXPECTED_PUBLISHER } else { 'The Partners in Business (PTY) LTD' }

function Assert-ExpectedPublisher([string]$Path) {
  $Signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($Signature.Status -ne 'Valid' -or -not $Signature.SignerCertificate) {
    throw "The PiB Windows installer signature is not valid: $($Signature.Status)."
  }
  $Publisher = $Signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($Publisher -cne $ExpectedPublisher) {
    throw "The PiB Windows installer has an unexpected publisher: $Publisher."
  }
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
  $BundleUrl = if ($env:PIB_RUNTIME_BUNDLE_URL) { $env:PIB_RUNTIME_BUNDLE_URL } else { "$ReleaseBase/partnersinbiz-runtime-windows-$Architecture-installer.cab" }
  $Archive = Join-Path $Stage 'runtime.cab'
  Write-Host 'Installing the signed Partners in Biz runtime...'
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
