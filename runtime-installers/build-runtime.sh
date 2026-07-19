#!/bin/bash
set -euo pipefail
command -v bun >/dev/null || { echo 'Bun is required to compile standalone runtime artifacts.' >&2;exit 1; }
npx tsc -p runtime-installers/runtime/tsconfig.json
OUT="runtime-installers/dist";rm -rf "$OUT";mkdir -p "$OUT"
TARGETS="${PIB_RUNTIME_TARGETS:-macos-arm64 macos-x64 windows-arm64 windows-x64 linux-x64 linux-arm64}"
for target in $TARGETS;do
  case "$target" in
    macos-arm64|macos-x64) bun_target="bun-${target/macos/darwin}";extension="" ;;
    windows-arm64|windows-x64) bun_target="bun-$target";extension=".exe" ;;
    linux-x64) bun_target="bun-linux-x64";extension="" ;;
    linux-arm64) bun_target="bun-linux-arm64";extension="" ;;
    *) echo "Unsupported runtime target: $target" >&2;exit 2 ;;
  esac
  stage="$OUT/$target";mkdir -p "$stage"
  if [[ "$target" == windows-arm64 && -n "${PIB_RUNTIME_PREBUILT_WINDOWS_ARM64_DIR:-}" ]];then
    for binary in pib-runtime.exe pib-release-manager.exe;do
      [[ -f "$PIB_RUNTIME_PREBUILT_WINDOWS_ARM64_DIR/$binary" ]] || { echo "Prebuilt Windows arm64 artifact is missing $binary." >&2;exit 1; }
      cp "$PIB_RUNTIME_PREBUILT_WINDOWS_ARM64_DIR/$binary" "$stage/$binary"
    done
  else
    bun build --compile --target="$bun_target" runtime-installers/runtime/cli.ts --outfile "$stage/pib-runtime$extension"
    bun build --compile --target="$bun_target" runtime-installers/runtime/release-manager.ts --outfile "$stage/pib-release-manager$extension"
  fi
  if [[ "$target" == macos-* ]];then
    command -v swiftc >/dev/null || { echo 'macOS native helper packaging blocked: install the Swift toolchain.' >&2;exit 1; }
    arch="${target#macos-}";[[ "$arch" != x64 ]]||arch=x86_64
    swiftc -O -target "$arch-apple-macos12" runtime-installers/macos/CredentialHelper.swift -o "$stage/pib-credential-helper"
    cp runtime-installers/macos/{install.sh,com.partnersinbiz.runtime.plist} "$stage/"
    cp runtime-installers/README.md "$stage/README.md"
  elif [[ "$target" == windows-* ]];then
    cp runtime-installers/windows/install.ps1 "$stage/"
    cp runtime-installers/README.md "$stage/README.md"
  else
    install -m 0755 runtime-installers/linux/{install.sh,pib-credential-helper,pib-file-helper} "$stage/"
    install -m 0644 runtime-installers/linux/pib-runtime.service "$stage/"
    cp runtime-installers/README.md "$stage/README.md"
  fi
done
if [[ " $TARGETS " == *' windows-'* ]] && [[ -z "$(dotnet --list-sdks 2>/dev/null || true)" ]];then
  echo 'Windows native helper/service packaging blocked: install a .NET SDK, then rerun this build.' >&2
  exit 1
fi
for arch in x64 arm64;do
  target="windows-$arch";[[ " $TARGETS " == *" $target "* ]]||continue
  dotnet publish runtime-installers/windows/PartnersInBizRuntimeService.csproj -c Release -r "win-$arch" --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "$OUT/$target/native"
  dotnet publish runtime-installers/windows/CredentialHelper.csproj -c Release -r "win-$arch" --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "$OUT/$target/credential-native"
  cp "$OUT/$target/native/PartnersInBizRuntimeService.exe" "$OUT/$target/"
  cp "$OUT/$target/credential-native/pib-credential-helper.exe" "$OUT/$target/"
  rm -rf "$OUT/$target/native" "$OUT/$target/credential-native"
done
for target in $TARGETS;do
  if [[ "$target" == linux-* ]];then arch="${target#linux-}";tar -czf "$OUT/partnersinbiz-runtime-linux-${arch}.tgz" -C "$OUT/$target" .
  elif [[ "$target" != windows-* ]];then tar -czf "$OUT/partnersinbiz-runtime-$target.tgz" -C "$OUT/$target" .
  fi
done
