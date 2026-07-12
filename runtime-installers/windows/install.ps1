[CmdletBinding()]
param(
  [ValidateSet('Install','Pair','Update','Rollback','Revoke','Uninstall')] [string]$Action = 'Install',
  [ValidatePattern('^[A-Za-z0-9_-]{1,128}$')] [string]$ChallengeId,
  [switch]$AllowUnsignedDev
)
$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:ProgramFiles 'Partners in Biz'
$Binary = Join-Path $Root 'pib-runtime.exe'
$Previous = Join-Path $Root 'pib-runtime.previous.exe'
$ApiBase = if ($env:PIB_API_BASE) { $env:PIB_API_BASE } else { 'https://partnersinbiz.online' }
$MetadataUrl = if ($env:PIB_RUNTIME_METADATA_URL) { $env:PIB_RUNTIME_METADATA_URL } else { "$ApiBase/runtime/windows/stable.json" }

function Assert-Administrator { if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run from an elevated PowerShell.' } }

# The runtime uses CredWrite/CredRead through Windows Credential Manager for its
# device credential, transport token and signing private key. Secrets are passed
# in memory only and never as process arguments, files, environment, or logs.
function Remove-RuntimeCredential { if (Test-Path $Binary) { & $Binary credential-delete --store 'Credential Manager' | Out-Null } }

function Test-ReleaseSignature([string]$Metadata, [string]$Payload) {
  if (-not $env:PIB_RUNTIME_SIGNER_THUMBPRINT) {
    if (-not $AllowUnsignedDev) { throw 'Production install refused: update signature key missing.' }
    Write-Warning 'UNSIGNED DEVELOPMENT MODE: package authenticity is not guaranteed.'
    return
  }
  $manifest = Get-Content -Raw $Metadata | ConvertFrom-Json
  $catalog = Join-Path (Split-Path $Metadata) 'release.cat'
  Invoke-WebRequest -UseBasicParsing -Uri $manifest.catalogUrl -OutFile $catalog
  $signature = Get-AuthenticodeSignature $catalog
  $expectedSigner = $env:PIB_RUNTIME_SIGNER_THUMBPRINT.Replace(' ', '').ToUpperInvariant()
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $expectedSigner) { throw 'Release catalog signature verification failed.' }
  if ((Test-FileCatalog -Path (Split-Path $Metadata) -CatalogFilePath $catalog -Detailed).Status -ne 'Valid') { throw 'Authenticated update metadata/payload catalog verification failed.' }
  $actualHash = (Get-FileHash -Algorithm SHA256 $Payload).Hash.ToLowerInvariant()
  if ($actualHash -ne ([string]$manifest.sha256).ToLowerInvariant()) { throw 'Release payload hash verification failed.' }
}

function Install-Runtime {
  Assert-Administrator
  $stage = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $stage | Out-Null
  try {
    $metadataPath = Join-Path $stage 'metadata.json'; Invoke-WebRequest -UseBasicParsing -Uri $MetadataUrl -OutFile $metadataPath
    $metadata = Get-Content -Raw $metadataPath | ConvertFrom-Json
    $payload = Join-Path $stage 'pib-runtime.exe'; Invoke-WebRequest -UseBasicParsing -Uri $metadata.payloadUrl -OutFile $payload
    Test-ReleaseSignature $metadataPath $payload
    & $payload enforce-minimum-version --metadata $metadataPath # minimumVersion gate
    New-Item -ItemType Directory -Force $Root | Out-Null
    if (Test-Path $Binary) { Copy-Item -Force $Binary $Previous }
    Copy-Item -Force $payload $Binary
    $xml = Join-Path $PSScriptRoot 'PartnersInBizRuntime.xml'
    Register-ScheduledTask -TaskName 'PartnersInBizRuntime' -Xml (Get-Content -Raw $xml) -Force | Out-Null
    Start-ScheduledTask -TaskName 'PartnersInBizRuntime'
  } finally { Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue }
}

function Pair-Runtime {
  if (-not $ChallengeId) { throw 'Pair requires ChallengeId.' }
  # The runtime securely prompts for the one-time code, creates/proves its key,
  # exchanges challengeId, uses CredWrite, sends its signed heartbeat with
  # bootstrapTransport=true, and emits signed execution receipts while bridging Hermes.
  & $Binary pair --challenge $ChallengeId --platform windows --prompt-code --credential-store credwrite
}
function Update-Runtime { Install-Runtime }
function Rollback-Runtime { Assert-Administrator; Copy-Item -Force $Previous $Binary; Start-ScheduledTask -TaskName 'PartnersInBizRuntime' }
function Revoke-Runtime { if (Test-Path $Binary) { & $Binary revoke --signed-request --execution-receipt }; Remove-RuntimeCredential }
function Uninstall-Runtime { Assert-Administrator; Revoke-Runtime; Unregister-ScheduledTask -TaskName 'PartnersInBizRuntime' -Confirm:$false -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue }

switch ($Action) { 'Install' { Install-Runtime }; 'Pair' { Pair-Runtime }; 'Update' { Update-Runtime }; 'Rollback' { Rollback-Runtime }; 'Revoke' { Revoke-Runtime }; 'Uninstall' { Uninstall-Runtime } }
