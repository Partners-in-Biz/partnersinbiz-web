[CmdletBinding()]
param(
  [ValidateSet('Install','Pair','Update','Rollback','Revoke','Uninstall')] [string]$Action = 'Install',
  [ValidatePattern('^[A-Za-z0-9_-]{1,128}$')] [string]$ChallengeId,
  [switch]$AllowUnsignedDev,
  [switch]$ForceLocal
)
$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:ProgramFiles 'Partners in Biz'
$Binary = Join-Path $Root 'current\pib-runtime.exe'
$Previous = Join-Path $Root 'previous\pib-runtime.exe'
$ApiBase = if ($env:PIB_API_BASE) { $env:PIB_API_BASE } else { 'https://partnersinbiz.online' }
$ReleaseBase = if ($env:PIB_RUNTIME_RELEASE_BASE) { $env:PIB_RUNTIME_RELEASE_BASE.TrimEnd('/') } else { 'https://github.com/Partners-in-Biz/partnersinbiz-web/releases/latest/download' }
$Architecture = $env:PROCESSOR_ARCHITECTURE.ToLowerInvariant().Replace('amd64','x64')
$MetadataUrl = if ($env:PIB_RUNTIME_METADATA_URL) { $env:PIB_RUNTIME_METADATA_URL } else { "$ReleaseBase/partnersinbiz-runtime-windows-$Architecture-stable.json" }
$ReleaseManager = if ($env:PIB_RELEASE_MANAGER) { $env:PIB_RELEASE_MANAGER } else { Join-Path $PSScriptRoot 'pib-release-manager.exe' }

function Assert-Administrator { if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run from an elevated PowerShell.' } }
function Wait-ServiceStopped { for($i=0;$i -lt 60;$i++){ $state=(& sc.exe query PartnersInBizRuntime | Select-String 'STATE').ToString();if($state -match 'STOPPED'){return};Start-Sleep -Milliseconds 250 };throw 'Runtime service did not reach SERVICE_STOPPED.' }

# The runtime uses CredWrite/CredRead through Windows Credential Manager for its
# device credential and signing private key. Secrets are passed
# in memory only and never as process arguments, files, environment, or logs.
function Remove-RuntimeCredential { if (Test-Path $Binary) { & $Binary credential-delete --store 'Credential Manager' | Out-Null } }

function Test-ReleaseSignature([string]$Metadata, [string]$Payload, [switch]$AllowDowngrade) {
  $manifest = Get-Content -Raw $Metadata | ConvertFrom-Json
  $artifactUnsigned=Test-Path (Join-Path (Split-Path $Metadata) '.unsigned-dev');$unsigned=$artifactUnsigned -or -not $env:PIB_RUNTIME_SIGNER_THUMBPRINT
  if ($unsigned) {
    if (-not $AllowUnsignedDev) { throw 'Production install refused: update signature key missing.' }
    Write-Warning 'UNSIGNED DEVELOPMENT MODE: package authenticity is not guaranteed.'
  } else { $catalog = Join-Path (Split-Path $Metadata) 'release.cat';if(-not(Test-Path $catalog)){Invoke-WebRequest -UseBasicParsing -Uri $manifest.catalogUrl -OutFile $catalog};$signature=Get-AuthenticodeSignature $catalog;$expectedSigner=$env:PIB_RUNTIME_SIGNER_THUMBPRINT.Replace(' ','').ToUpperInvariant();if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $expectedSigner){throw 'Release catalog signature verification failed.'};if((Test-FileCatalog -Path (Split-Path $Metadata) -CatalogFilePath $catalog -Detailed).Status -ne 'Valid'){throw 'Authenticated update metadata/payload catalog verification failed.'} }
  if(-not(Test-Path $ReleaseManager)){throw 'Signed release manager is missing.'}
  $currentVersion=$env:PIB_RUNTIME_CURRENT_VERSION
  if(-not $currentVersion -and (Test-Path $Binary)){
    $currentManifest=Join-Path (Split-Path $Binary) 'metadata.json';$currentSignature=Join-Path (Split-Path $Binary) 'manifest.sig'
    $currentUnsigned=Test-Path (Join-Path (Split-Path $Binary) '.unsigned-dev');if($currentUnsigned -and -not $AllowUnsignedDev){throw 'Production refused an installed unsigned development release.'};if(-not $currentUnsigned -and -not(Test-Path $currentSignature)){throw 'Installed release verification material is missing.'}
    $installedArgs=@('installed-version','--manifest',$currentManifest,'--payload',$Binary,'--platform','windows','--architecture',$env:PROCESSOR_ARCHITECTURE.ToLowerInvariant().Replace('amd64','x64'),'--channel','stable');if($currentUnsigned){$installedArgs+='--allow-unsigned-dev'}else{$installedArgs+=@('--signature',$currentSignature,'--public-key',(Join-Path $PSScriptRoot 'release-public.pem'))};$currentVersion=& $ReleaseManager @installedArgs
    if($LASTEXITCODE -ne 0){throw 'Installed release verification failed.'}
  }
  if(-not $currentVersion){$currentVersion=[string]$manifest.minimumVersion}
  $releaseArgs=@('verify','--manifest',$Metadata,'--payload',$Payload,'--platform','windows','--architecture',$env:PROCESSOR_ARCHITECTURE.ToLowerInvariant().Replace('amd64','x64'),'--current-version',$currentVersion,'--channel','stable')
  if($unsigned){$releaseArgs+='--allow-unsigned-dev'}else{$releaseArgs+=@('--signature',(Join-Path (Split-Path $Metadata) 'manifest.sig'),'--public-key',(Join-Path $PSScriptRoot 'release-public.pem'))}
  if($AllowDowngrade){$releaseArgs+='--allow-downgrade'};& $ReleaseManager @releaseArgs
  if($LASTEXITCODE -ne 0){throw 'Release manager verification failed.'}
}

function Install-Runtime {
  Assert-Administrator
  $stage = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $stage | Out-Null
  try {
    $metadataPath = Join-Path $stage 'metadata.json'; Invoke-WebRequest -UseBasicParsing -Uri $MetadataUrl -OutFile $metadataPath
    if($env:PIB_RUNTIME_SIGNER_THUMBPRINT){Invoke-WebRequest -UseBasicParsing -Uri "$MetadataUrl.sig" -OutFile (Join-Path $stage 'manifest.sig')}
    $metadata = Get-Content -Raw $metadataPath | ConvertFrom-Json
    $payload = Join-Path $stage 'pib-runtime.exe'; Invoke-WebRequest -UseBasicParsing -Uri $metadata.payloadUrl -OutFile $payload
    Test-ReleaseSignature $metadataPath $payload
    $release=Join-Path $stage 'release';New-Item -ItemType Directory $release|Out-Null;Copy-Item $payload (Join-Path $release 'pib-runtime.exe');Copy-Item $ReleaseManager (Join-Path $release 'pib-release-manager.exe');Copy-Item (Join-Path $PSScriptRoot 'pib-credential-helper.exe') (Join-Path $release 'pib-credential-helper.exe');Copy-Item $metadataPath (Join-Path $release 'metadata.json');if($AllowUnsignedDev -and -not $env:PIB_RUNTIME_SIGNER_THUMBPRINT){New-Item -ItemType File (Join-Path $release '.unsigned-dev')|Out-Null}else{Copy-Item (Join-Path $stage 'manifest.sig') (Join-Path $release 'manifest.sig');Copy-Item (Join-Path $stage 'release.cat') (Join-Path $release 'release.cat')}
    & sc.exe stop PartnersInBizRuntime 2>$null|Out-Null;if((Get-Service PartnersInBizRuntime -ErrorAction SilentlyContinue)){Wait-ServiceStopped};New-Item -ItemType Directory -Force $Root | Out-Null;$current=Join-Path $Root 'current';$previous=Join-Path $Root 'previous';$old=Join-Path $Root 'previous.new';Remove-Item -Recurse -Force $old -ErrorAction SilentlyContinue;if(Test-Path $current){Move-Item $current $old};Move-Item $release $current;Remove-Item -Recurse -Force $previous -ErrorAction SilentlyContinue;if(Test-Path $old){Move-Item $old $previous}
    Copy-Item -Force (Join-Path $PSScriptRoot 'PartnersInBizRuntimeService.exe') (Join-Path $Root 'PartnersInBizRuntimeService.exe')
    & sc.exe query PartnersInBizRuntime 2>$null|Out-Null;if($LASTEXITCODE -eq 0){& sc.exe config PartnersInBizRuntime binPath= "`"$Root\PartnersInBizRuntimeService.exe`"" start= auto obj= LocalSystem}else{& sc.exe create PartnersInBizRuntime binPath= "`"$Root\PartnersInBizRuntimeService.exe`"" start= auto obj= LocalSystem};if($LASTEXITCODE -ne 0){throw 'Runtime service registration failed.'};$HermesHome=Join-Path $env:USERPROFILE '.hermes';& reg.exe add 'HKLM\SYSTEM\CurrentControlSet\Services\PartnersInBizRuntime' /v Environment /t REG_MULTI_SZ /d "PIB_HERMES_HOME=$HermesHome" /f|Out-Null;& sc.exe start PartnersInBizRuntime;if($LASTEXITCODE -ne 0){throw 'Runtime service failed to start.'}
  } finally { Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue }
}

function Pair-Runtime {
  if (-not $ChallengeId) { throw 'Pair requires ChallengeId.' }
  $code=Read-Host 'One-time pairing code' -AsSecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($code)
  try{$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr);$json=@{challengeId=$ChallengeId;code=$plain}|ConvertTo-Json -Compress;$bytes=[Text.Encoding]::UTF8.GetBytes($json);$encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine);[Array]::Clear($bytes,0,$bytes.Length);$dir=Join-Path $env:ProgramData 'PartnersInBiz';New-Item -ItemType Directory -Force $dir|Out-Null;& icacls.exe $dir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F'|Out-Null;$tmp=Join-Path $dir 'pairing.tmp';[IO.File]::WriteAllBytes($tmp,$encrypted);Move-Item -Force $tmp (Join-Path $dir 'pairing.ready')}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}
function Update-Runtime { Install-Runtime }
function Rollback-Runtime { Assert-Administrator; if(-not(Test-Path $Previous)){throw 'No verified previous release.'};$previous=Split-Path $Previous;Test-ReleaseSignature (Join-Path $previous 'metadata.json') $Previous -AllowDowngrade;& sc.exe stop PartnersInBizRuntime|Out-Null;Wait-ServiceStopped;$current=Split-Path $Binary;$swap=Join-Path $Root 'swap';Move-Item $current $swap;Move-Item $previous $current;Move-Item $swap $previous;& sc.exe start PartnersInBizRuntime;if($LASTEXITCODE -ne 0){throw 'Runtime service failed to restart after rollback.'} }
function Revoke-Runtime { if(Get-Service PartnersInBizRuntime -ErrorAction SilentlyContinue){& sc.exe control PartnersInBizRuntime 128|Out-Null;Start-Sleep -Seconds 3}elseif(Test-Path $Binary){& $Binary revoke} }
function Uninstall-Runtime { Assert-Administrator;Revoke-Runtime;$pending=Join-Path $env:ProgramData 'PartnersInBiz\revocation-pending.json';if(Test-Path $pending){if(-not $ForceLocal){throw 'Remote revoke pending. Runtime and secure identity retained in revoke-only recovery mode.'};Write-Warning 'FORCE LOCAL: revoke this computer in the PiB portal; only the nonsecret recovery marker will remain.';Remove-RuntimeCredential};& sc.exe stop PartnersInBizRuntime;& sc.exe delete PartnersInBizRuntime;Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue }

switch ($Action) { 'Install' { Install-Runtime }; 'Pair' { Pair-Runtime }; 'Update' { Update-Runtime }; 'Rollback' { Rollback-Runtime }; 'Revoke' { Revoke-Runtime }; 'Uninstall' { Uninstall-Runtime } }
