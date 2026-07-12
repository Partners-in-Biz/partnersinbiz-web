#!/bin/bash
set -euo pipefail
npx tsc -p runtime-installers/runtime/tsconfig.json
if command -v dotnet >/dev/null && [[ -n "$(dotnet --list-sdks 2>/dev/null)" ]]; then dotnet build runtime-installers/windows/PartnersInBizRuntimeService.csproj -c Release; else echo 'Windows service native build skipped: .NET SDK unavailable.' >&2; fi
OUT="runtime-installers/dist"; rm -rf "$OUT"; mkdir -p "$OUT"
for target in macos-arm64 macos-x64 windows-arm64 windows-x64; do
  stage="$OUT/$target"; mkdir -p "$stage/runtime"
  cp -R runtime-installers/runtime/dist/. "$stage/runtime/"
  cp runtime-installers/runtime/package.json "$stage/runtime/"
  if [[ "$target" == macos-* ]]; then cp runtime-installers/macos/{install.sh,CredentialHelper.swift,com.partnersinbiz.runtime.plist} "$stage/"; else cp runtime-installers/windows/{install.ps1,CredentialHelper.cs,PartnersInBizRuntimeService.cs,PartnersInBizRuntimeService.csproj} "$stage/"; fi
  tar -czf "$OUT/partnersinbiz-runtime-$target-source.tgz" -C "$stage" .
done
