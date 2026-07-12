#!/bin/bash
set -euo pipefail
command -v bun >/dev/null || { echo 'Bun is required to compile standalone runtime artifacts.' >&2;exit 1; }
npx tsc -p runtime-installers/runtime/tsconfig.json
OUT="runtime-installers/dist";rm -rf "$OUT";mkdir -p "$OUT"
for target in macos-arm64 macos-x64 windows-arm64 windows-x64;do
  stage="$OUT/$target";mkdir -p "$stage"
  bun_target="bun-${target/macos/darwin}";extension="";[[ "$target" != windows-* ]]||extension=".exe"
  bun build --compile --target="$bun_target" runtime-installers/runtime/cli.ts --outfile "$stage/pib-runtime$extension"
  bun build --compile --target="$bun_target" runtime-installers/runtime/release-manager.ts --outfile "$stage/pib-release-manager$extension"
  if [[ "$target" == macos-* ]];then
    arch="${target#macos-}";[[ "$arch" != x64 ]]||arch=x86_64
    swiftc -O -target "$arch-apple-macos12" runtime-installers/macos/CredentialHelper.swift -o "$stage/pib-credential-helper"
    cp runtime-installers/macos/{install.sh,com.partnersinbiz.runtime.plist} "$stage/"
  else
    cp runtime-installers/windows/{install.ps1,CredentialHelper.cs,PartnersInBizRuntimeService.cs,PartnersInBizRuntimeService.csproj} "$stage/"
  fi
done
if [[ -z "$(dotnet --list-sdks 2>/dev/null || true)" ]];then
  echo 'Windows native helper/service packaging blocked: install a .NET SDK, then rerun this build.' >&2
  exit 1
fi
dotnet publish runtime-installers/windows/PartnersInBizRuntimeService.csproj -c Release -r win-x64 --self-contained true -o "$OUT/windows-x64/native"
dotnet publish runtime-installers/windows/PartnersInBizRuntimeService.csproj -c Release -r win-arm64 --self-contained true -o "$OUT/windows-arm64/native"
dotnet publish runtime-installers/windows/CredentialHelper.csproj -c Release -r win-x64 --self-contained true -o "$OUT/windows-x64/credential-native"
dotnet publish runtime-installers/windows/CredentialHelper.csproj -c Release -r win-arm64 --self-contained true -o "$OUT/windows-arm64/credential-native"
for target in windows-x64 windows-arm64;do cp "$OUT/$target/native/PartnersInBizRuntimeService.exe" "$OUT/$target/";cp "$OUT/$target/credential-native/pib-credential-helper.exe" "$OUT/$target/";done
for target in macos-arm64 macos-x64 windows-arm64 windows-x64;do tar -czf "$OUT/partnersinbiz-runtime-$target.tgz" -C "$OUT/$target" .;done
