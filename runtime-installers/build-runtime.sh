#!/bin/bash
set -euo pipefail
npx tsc -p runtime-installers/runtime/tsconfig.json
if command -v dotnet >/dev/null; then dotnet build runtime-installers/windows/PartnersInBizRuntimeService.csproj -c Release; fi
