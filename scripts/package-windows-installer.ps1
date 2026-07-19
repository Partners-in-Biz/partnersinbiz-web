[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Stage,
  [Parameter(Mandatory=$true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
$StagePath = (Resolve-Path -LiteralPath $Stage).Path
$DestinationPath = [IO.Path]::GetFullPath($Destination)
$DestinationDirectory = Split-Path -Parent $DestinationPath
$DestinationName = Split-Path -Leaf $DestinationPath
$Required = @(
  'pib-runtime.exe',
  'pib-release-manager.exe',
  'pib-credential-helper.exe',
  'PartnersInBizRuntimeService.exe',
  'install.ps1',
  'release-public.pem',
  'README.md'
)

if (Get-ChildItem -LiteralPath $StagePath -Directory) {
  throw 'Windows installer stage must be flat.'
}
foreach ($Name in $Required) {
  if (-not (Test-Path -LiteralPath (Join-Path $StagePath $Name) -PathType Leaf)) {
    throw "Windows installer stage is missing $Name."
  }
}

New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null
Remove-Item -LiteralPath $DestinationPath -Force -ErrorAction SilentlyContinue
$DdfPath = Join-Path ([IO.Path]::GetTempPath()) ("pib-runtime-{0}.ddf" -f [guid]::NewGuid().ToString('N'))
try {
  $Lines = @(
    '.OPTION EXPLICIT',
    '.Set Cabinet=on',
    '.Set Compress=on',
    '.Set CompressionType=LZX',
    '.Set CompressionMemory=21',
    '.Set MaxDiskSize=0',
    '.Set InfFileName=NUL',
    '.Set RptFileName=NUL',
    ".Set CabinetNameTemplate=`"$DestinationName`"",
    ".Set DiskDirectoryTemplate=`"$DestinationDirectory`""
  )
  foreach ($File in Get-ChildItem -LiteralPath $StagePath -File | Sort-Object Name) {
    $Source = $File.FullName.Replace('"', '""')
    $Name = $File.Name.Replace('"', '""')
    $Lines += "`"$Source`" `"$Name`""
  }
  [IO.File]::WriteAllLines($DdfPath, $Lines, [Text.UTF8Encoding]::new($false))
  & makecab.exe /F $DdfPath
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $DestinationPath -PathType Leaf)) {
    throw 'makecab.exe did not create the Windows installer.'
  }
} finally {
  Remove-Item -LiteralPath $DdfPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Created $DestinationPath"
