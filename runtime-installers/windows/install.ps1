[CmdletBinding()]
param(
  [ValidateSet('Install','Pair','Update','Rollback','Revoke','Uninstall')] [string]$Action = 'Install',
  [ValidatePattern('^[A-Za-z0-9_-]{1,128}$')] [string]$ChallengeId,
  [switch]$AllowUnsignedDev
)
$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:ProgramFiles 'Partners in Biz'
$Binary = Join-Path $Root 'current\pib-runtime.exe'
$Previous = Join-Path $Root 'previous\pib-runtime.exe'
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
  if(-not(Test-Path $catalog)){Invoke-WebRequest -UseBasicParsing -Uri $manifest.catalogUrl -OutFile $catalog}
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
    $release=Join-Path $stage 'release';New-Item -ItemType Directory $release|Out-Null;Copy-Item $payload (Join-Path $release 'pib-runtime.exe');Copy-Item $metadataPath (Join-Path $release 'metadata.json');Copy-Item (Join-Path $stage 'release.cat') (Join-Path $release 'release.cat')
    & sc.exe stop PartnersInBizRuntime 2>$null|Out-Null;New-Item -ItemType Directory -Force $Root | Out-Null;$current=Join-Path $Root 'current';$previous=Join-Path $Root 'previous';$old=Join-Path $Root 'previous.new';Remove-Item -Recurse -Force $old -ErrorAction SilentlyContinue;if(Test-Path $current){Move-Item $current $old};Move-Item $release $current;Remove-Item -Recurse -Force $previous -ErrorAction SilentlyContinue;if(Test-Path $old){Move-Item $old $previous}
    Copy-Item -Force (Join-Path $PSScriptRoot 'PartnersInBizRuntimeService.exe') (Join-Path $Root 'PartnersInBizRuntimeService.exe')
    & sc.exe create PartnersInBizRuntime binPath= "`"$Root\PartnersInBizRuntimeService.exe`"" start= auto obj= LocalSystem
    & sc.exe start PartnersInBizRuntime
  } finally { Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue }
}

function Pair-Runtime {
  if (-not $ChallengeId) { throw 'Pair requires ChallengeId.' }
  $code=Read-Host 'One-time pairing code' -AsSecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($code)
  try{$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr);$json=@{challengeId=$ChallengeId;code=$plain}|ConvertTo-Json -Compress;$bytes=[Text.Encoding]::UTF8.GetBytes($json);$encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine);[Array]::Clear($bytes,0,$bytes.Length);$dir=Join-Path $env:ProgramData 'PartnersInBiz';New-Item -ItemType Directory -Force $dir|Out-Null;& icacls.exe $dir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F'|Out-Null;$tmp=Join-Path $dir 'pairing.tmp';[IO.File]::WriteAllBytes($tmp,$encrypted);Move-Item -Force $tmp (Join-Path $dir 'pairing.ready')}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}
function Update-Runtime { Install-Runtime }
function Rollback-Runtime { Assert-Administrator; if(-not(Test-Path $Previous)){throw 'No verified previous release.'};$previous=Split-Path $Previous;Test-ReleaseSignature (Join-Path $previous 'metadata.json') $Previous;& $Previous enforce-minimum-version --metadata (Join-Path $previous 'metadata.json');$current=Split-Path $Binary;$swap=Join-Path $Root 'swap';Move-Item $current $swap;Move-Item $previous $current;Move-Item $swap $previous;& sc.exe start PartnersInBizRuntime }
function Revoke-Runtime { if (Test-Path $Binary) { & $Binary revoke --signed-request --execution-receipt }; Remove-RuntimeCredential }
function Uninstall-Runtime { Assert-Administrator; Revoke-Runtime; & sc.exe stop PartnersInBizRuntime; & sc.exe delete PartnersInBizRuntime; Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue }

switch ($Action) { 'Install' { Install-Runtime }; 'Pair' { Pair-Runtime }; 'Update' { Update-Runtime }; 'Rollback' { Rollback-Runtime }; 'Revoke' { Revoke-Runtime }; 'Uninstall' { Uninstall-Runtime } }
