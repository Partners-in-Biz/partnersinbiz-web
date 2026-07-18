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
  if ($Profile -ne 'pip' -and -not (Test-Path $ProfileHome)) { & hermes profile create $Profile --description "Partners in Biz $Profile agent" }
  Write-Host "Configure the model for $Profile. Requested providers: $($RequestedProviders -join ', ')"
  if ($Profile -eq 'pip' -and -not (Test-Path $ProfileHome)) { & hermes setup model; & hermes gateway install; & hermes gateway start }
  else { & hermes -p $Profile setup model; & hermes -p $Profile gateway install; & hermes -p $Profile gateway start }
}

$Stage = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $Stage | Out-Null
try {
  $BundleUrl = if ($env:PIB_RUNTIME_BUNDLE_URL) { $env:PIB_RUNTIME_BUNDLE_URL } else { "$ReleaseBase/partnersinbiz-runtime-windows-$Architecture-installer.zip" }
  $Archive = Join-Path $Stage 'runtime.zip'
  Write-Host 'Installing the signed Partners in Biz runtime...'
  Invoke-WebRequest -UseBasicParsing -Uri $BundleUrl -OutFile $Archive
  Expand-Archive -Path $Archive -DestinationPath (Join-Path $Stage 'runtime')
  $Installer = Get-ChildItem (Join-Path $Stage 'runtime') -Filter install.ps1 -Recurse | Select-Object -First 1
  if (-not $Installer) { throw 'The signed PiB runtime bundle is incomplete.' }
  & $Installer.FullName -Action Install
  & $Installer.FullName -Action Pair -ChallengeId $ChallengeId
  Write-Host 'Computer linked. Keep Hermes and the PiB runtime running to stay available.'
} finally { Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue }
