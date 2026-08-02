import fs from 'node:fs'
import path from 'node:path'

const LINUX_RUNTIME_MARKERS = [
  'workspace.sync',
  'syncProtocolVersion',
  'workspace-sync-receipts.json',
  'revocation-pending.json',
  'Remote revoke pending',
] as const

export function verifyLinuxRuntimeArtifact(source: Buffer): string[] {
  return LINUX_RUNTIME_MARKERS
    .filter((marker) => !source.includes(Buffer.from(marker)))
    .map((marker) => `compiled Linux runtime: missing ${marker}`)
}

export function verifyLinkedRuntimeInstallers(root = process.cwd()): string[] {
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const errors: string[] = []
const requireText = (name: string, source: string, pattern: RegExp) => {
  if (!pattern.test(source)) errors.push(`${name}: missing ${pattern}`)
}
const rejectText = (name: string, source: string, pattern: RegExp) => {
  if (pattern.test(source)) errors.push(`${name}: forbidden ${pattern}`)
}

const mac = read('runtime-installers/macos/install.sh')
const plist = read('runtime-installers/macos/com.partnersinbiz.runtime.plist')
const win = read('runtime-installers/windows/install.ps1')
const linux = read('runtime-installers/linux/install.sh')
const linuxService = read('runtime-installers/linux/pib-runtime.service')
const linuxCredentialHelper = read('runtime-installers/linux/pib-credential-helper')
const linuxFileHelper = read('runtime-installers/linux/pib-file-helper')
const docs = read('runtime-installers/README.md')
const macBootstrap = read('public/runtime/bootstrap/macos.sh')
const linuxBootstrap = read('public/runtime/bootstrap/linux.sh')
const windowsBootstrap = read('public/runtime/bootstrap/windows.ps1')
const structural = validatePowerShellStructure(win); if(structural) errors.push(`Windows PowerShell: ${structural}`)
const bootstrapStructural = validatePowerShellStructure(windowsBootstrap); if(bootstrapStructural) errors.push(`Windows bootstrap PowerShell: ${bootstrapStructural}`)

const runtimeCli=read('runtime-installers/runtime/cli.ts')
const runtime=['client.ts','worker.ts','core.ts','bridge.ts','release-manager.ts','workspace-sync.ts','sync-model.ts'].map(file=>read(`runtime-installers/runtime/${file}`)).concat(runtimeCli).join('\n')
for (const [name, source] of [['macOS', mac+runtime], ['Windows', win+runtime], ['Linux', linux+runtime]] as const) {
  requireText(name, source, /challengeId/i)
  requireText(name, source, /pair/i)
  requireText(name, source, /heartbeat/i)
  requireText(name, source, /execution[- ]receipt|receipt/i)
  requireText(name, source, /update/i)
  requireText(name, source, /minimumVersion/i)
  requireText(name, source, /rollback/i)
  requireText(name, source, /uninstall/i)
  requireText(name, source, /revoke/i)
  requireText(name, source, /signature/i)
  rejectText(name, source, /(?:api[_-]?key|device[_-]?credential|transport[_-]?token)\s*=\s*["'][A-Za-z0-9_\/-]{16,}/i)
  rejectText(name, source, /(?:--credential(?!-store)|--transport-token|--private-key|--pairing-code)\b/i)
}
rejectText('runtime heartbeat',runtimeCli,/bootstrapTransport/)
for (const [name, source] of [['macOS bootstrap', macBootstrap], ['Linux bootstrap', linuxBootstrap], ['Windows bootstrap', windowsBootstrap]] as const) {
  requireText(name, source, /hermes-agent\.nousresearch\.com/)
  requireText(name, source, /profile create/)
  requireText(name, source, /setup model/)
  requireText(name, source, /gateway (?:install|start)/)
  requireText(name, source, /partnersinbiz-runtime-[^\s"']+-installer/)
  requireText(name, source, /github\.com\/Partners-in-Biz\/partnersinbiz-web\/releases\/latest\/download/)
  requireText(name, source, /challenge/i)
  rejectText(name, source, /(?:OPENAI|ANTHROPIC|OPENROUTER|GOOGLE|XAI)_API_KEY\s*=/i)
}
requireText('Hermes profile discovery', read('runtime-installers/runtime/hermes.ts'), /profiles[\s\S]*API_SERVER_PORT[\s\S]*API_SERVER_KEY/)

requireText('macOS', mac, /security (?:add|find)-generic-password/)
requireText('macOS', mac, /launchctl (?:bootstrap|bootout|kickstart)/)
requireText('macOS plist', plist, /com\.partnersinbiz\.runtime/)
requireText('macOS plist', plist, /KeepAlive/)
requireText('Windows', win, /CredWrite|Credential Manager/)
requireText('Linux release manager', linux, /verify_release[\s\S]*RELEASE_MANAGER/)
requireText('Linux systemd service', linuxService, /User=root[\s\S]*ExecStart=\/opt\/partnersinbiz\/current\/pib-runtime service/)
requireText('Linux systemd service hardening', linuxService, /NoNewPrivileges=true/)
requireText('Linux systemd service umask', linuxService, /UMask=0077/)
requireText('Linux native sync protocol', linuxService, /PIB_SYNC_PROTOCOL_VERSION=1/)
requireText('Linux systemd-creds host encryption', linuxCredentialHelper, /systemd-creds encrypt[\s\S]*--with-key=host/)
requireText('Linux systemd-creds authenticated decryption', linuxCredentialHelper, /systemd-creds decrypt[\s\S]*--name=/)
requireText('Linux encrypted credential atomic replace', linuxCredentialHelper, /mktemp[\s\S]*mv -f/)
rejectText('Linux credential plaintext', linuxCredentialHelper, /(?:identity|plaintext)\.(?:json|tmp)/i)
requireText('Linux descriptor-relative rename', linuxFileHelper, /os\.rename\([^\n]*src_dir_fd=0[^\n]*dst_dir_fd=0/)
requireText('Linux descriptor-exclusive rename', linuxFileHelper, /renameat2[\s\S]*RENAME_NOREPLACE/)
requireText('Linux descriptor-relative mkdir', linuxFileHelper, /os\.mkdir\([^\n]*dir_fd=0/)
requireText('Linux descriptor-relative unlink', linuxFileHelper, /os\.unlink\([^\n]*dir_fd=0/)
requireText('Linux descriptor-relative rmdir', linuxFileHelper, /os\.rmdir\([^\n]*dir_fd=0/)
rejectText('Linux descriptor traversal', linuxFileHelper, /os\.(?:rename|mkdir|unlink|rmdir)\([^\n]*path\.join/)
requireText('runtime service', runtime, /pollForever/)
requireText('runtime native sync capability', runtime, /workspace\.sync/)
requireText('runtime native sync protocol', runtime, /syncProtocolVersion/)
requireText('runtime durable sync receipt retention', runtime, /workspace-sync-receipts\.json/)
rejectText('runtime service', runtime, /createServer|\.listen\s*\(/)
requireText('runtime signed client', read('runtime-installers/runtime/client.ts'), /x-device-signature/)
requireText('macOS release manager', mac, /RELEASE_MANAGER[\s\S]*verify/)
requireText('Windows release manager', win, /releaseArgs=[\s\S]*'verify'[\s\S]*& \$ReleaseManager @releaseArgs/)
const build = read('runtime-installers/build-runtime.sh')
requireText('build matrix', build, /macos-arm64 macos-x64 windows-arm64 windows-x64 linux-x64 linux-arm64/)
requireText('compiled runtime matrix', build, /bun build --compile/)
requireText('compiled Linux x64 runtime', build, /bun-linux-x64/)
requireText('compiled Linux arm64 runtime', build, /bun-linux-arm64/)
requireText('Linux package archives', build, /partnersinbiz-runtime-linux-\$\{arch\}\.tgz/)
requireText('native Windows matrix', build, /for arch in x64 arm64[\s\S]*dotnet publish[\s\S]*win-\$arch/)
requireText('self-contained single-file Windows executables', build, /dotnet publish[\s\S]*--self-contained true[\s\S]*PublishSingleFile=true/)
requireText('Windows arm64 cross-runner handoff', build, /PIB_RUNTIME_PREBUILT_WINDOWS_ARM64_DIR[\s\S]*pib-release-manager\.exe/)
for (const target of ['linux-x64','linux-arm64']) {
  const artifact = path.join(root, 'runtime-installers/dist', target, 'pib-runtime')
  if (fs.existsSync(artifact)) errors.push(...verifyLinuxRuntimeArtifact(fs.readFileSync(artifact)).map(error=>`${target} ${error}`))
}
requireText('Windows', win, /sc\.exe create PartnersInBizRuntime/)
requireText('Windows service', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /ServiceBase/)
requireText('Windows worker supervision', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /Supervise\(stopping\.Token\)/)
requireText('Windows worker restart', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /WaitForExit\(500\)[\s\S]*restarting/)
requireText('Windows clean service stop', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /stopping\?\.Cancel\(\)[\s\S]*supervisor\?\.Join/)
requireText('Windows service identity', win, /obj= LocalSystem/)
requireText('Windows Hermes home bridge', win, /PIB_HERMES_HOME=.*HermesHome/)
requireText('Windows DPAPI handoff', win, /DataProtectionScope]::LocalMachine/)
requireText('Windows service DPAPI package', read('runtime-installers/windows/PartnersInBizRuntimeService.csproj'), /System\.Security\.Cryptography\.ProtectedData/)
requireText('Windows handoff ACL', win, /SYSTEM:\(OI\)\(CI\)F.*Administrators:\(OI\)\(CI\)F/)
requireText('Windows credential read', read('runtime-installers/windows/CredentialHelper.cs'), /CredRead/)
requireText('Windows credential exact free', read('runtime-installers/windows/CredentialHelper.cs'), /Zero\(pointer,bytes\.Length\)[\s\S]*FreeHGlobal\(pointer\)/)
rejectText('Windows credential allocation', read('runtime-installers/windows/CredentialHelper.cs'), /ZeroFreeGlobalAllocUnicode/)
requireText('Windows atomic handoff claim', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /File\.Move\(ready,claim\)/)
requireText('documentation', docs, /UNSIGNED DEVELOPMENT MODE/)
requireText('documentation', docs, /signed and notarised/i)
requireText('macOS', mac, /PIB_ALLOW_UNSIGNED_DEV/)
requireText('macOS unsigned marker', mac, /\.unsigned-dev/)
rejectText('macOS signature path', mac, /metadata\.json\.sig/)
requireText('Windows', win, /AllowUnsignedDev/)
requireText('Windows update Authenticode', win, /Assert-ExpectedPublisher \$Payload/)
requireText('Windows update Ed25519', win, /manifest\.sig[\s\S]*release-public\.pem|PublicKey/)
rejectText('Windows legacy catalog URL', win, /catalogUrl|PIB_RUNTIME_SIGNER_THUMBPRINT/)
requireText('Windows bootstrap signed CAB', windowsBootstrap, /installer\.cab[\s\S]*Assert-ExpectedPublisher \$Archive/)
requireText('Windows bootstrap executable verification', windowsBootstrap, /RequiredExecutables[\s\S]*Assert-ExpectedPublisher \$Executable/)
requireText('Windows internal explicit consent', windowsBootstrap, /InternalStaff[\s\S]*ConfirmInternalTrust/)
requireText('Windows internal certificate pin', windowsBootstrap, /F40112CCB174A9FF5B7F56388D66BBA9CC98D9655C817B66B5F0A3D5A4DB7042/)
requireText('Windows internal least-privilege machine trust', windowsBootstrap, /@\('TrustedPeople','TrustedPublisher'\)/)
requireText('Windows internal signer verification', windowsBootstrap, /InternalStaff[\s\S]*Assert-InternalCertificate \$Signature\.SignerCertificate/)
rejectText('Windows bootstrap ZIP', windowsBootstrap, /Expand-Archive|installer\.zip/)
const internalWindowsWorkflow = read('.github/workflows/release-linked-runtime-windows-internal.yml')
requireText('Windows internal isolated tag', internalWindowsWorkflow, /runtime-internal-v\$env:VERSION/)
requireText('Windows internal PFX secret', internalWindowsWorkflow, /PIB_WINDOWS_INTERNAL_SIGNING_PFX_BASE64/)
requireText('Windows internal Authenticode', internalWindowsWorkflow, /signtool\.exe[\s\S]*SHA256/)
requireText('Windows internal temporary peer trust', internalWindowsWorkflow, /certutil\.exe -user -f -addstore TrustedPeople/)
requireText('Windows internal prerelease', internalWindowsWorkflow, /--prerelease/)
rejectText('Windows internal SSL.com dependency', internalWindowsWorkflow, /sslcom|ESIGNER/i)
const windowsPackager = read('scripts/package-windows-installer.ps1')
requireText('Windows CAB packager', windowsPackager, /makecab\.exe/)
requireText('Windows CAB required contents', windowsPackager, /pib-runtime\.exe[\s\S]*PartnersInBizRuntimeService\.exe[\s\S]*release-public\.pem/)
requireText('Windows force-local warning',win,/ForceLocal[\s\S]*FORCE LOCAL/)
requireText('macOS revoke-only retention',mac,/Remote revoke pending[\s\S]*revoke-only recovery mode/)
requireText('Windows unsigned marker', win, /\.unsigned-dev/)
requireText('Windows rollback stop fence', win, /Rollback-Runtime[\s\S]*sc\.exe stop[\s\S]*Wait-ServiceStopped/)
requireText('Linux pairing', linux, /pair --challenge "\$challenge" --platform linux/)
requireText('Linux Hermes home runtime bridge', linux, /PIB_HERMES_HOME="\$HERMES_HOME_PATH"/)
requireText('Linux Hermes home service persistence', linux, /write_runtime_environment PIB_HERMES_HOME/)
requireText('Linux bootstrap user Hermes handoff', linuxBootstrap, /sudo env PIB_HERMES_HOME="\$hermes_home"/)
requireText('Linux mapping', linux, /map --mapping "\$1" --folder "\$2"/)
requireText('Linux revoke-only retention', linux, /Remote revoke pending[\s\S]*revoke-only recovery mode/)
requireText('Linux force-local warning', linux, /force-local[\s\S]*FORCE LOCAL/i)
requireText('Linux service lifecycle', linux, /(?:systemctl|SYSTEMCTL)[\s\S]*daemon-reload[\s\S]*enable/)

// The browser handoff is deliberately a non-secret command contract.
const safeCommands = [
  'pib-runtime pair --challenge challenge_123 --platform macos',
  'pib-runtime pair --challenge challenge_123 --platform windows',
  'pib-runtime pair --challenge challenge_123 --platform linux',
]
for (const command of safeCommands) {
  const options = [...command.matchAll(/--([\w-]+)/g)].map((match) => match[1])
  if (options.some((option) => !['challenge', 'platform'].includes(option))) errors.push(`unsafe install command: ${command}`)
}

return errors
}

export function validatePowerShellStructure(source:string):string|null {
  const stack:string[]=[];let quote='',here='',comment=false,quoteStart=0
  const pairs:Record<string,string>={')':'(',']':'[','}':'{'}
  for(let i=0;i<source.length;i++){
    const c=source[i],n=source[i+1]
    if(comment){if(c==='\n')comment=false;continue}
    if(here){if((i===0||source[i-1]==='\n')&&source.startsWith(here+'@',i)){i++;here=''}continue}
    if(quote){if(c===quote){let ticks=0;for(let j=i-1;j>=0&&source[j]==='`';j--)ticks++;if(ticks%2===1)continue;if(n===quote){i++;continue}quote=''}continue}
    if(c==='#'){comment=true;continue}
    if(c==='@'&&(n==='"'||n==="'")&&(i===0||/\s/.test(source[i-1]))){here=n;i++;continue}
    if(c==='"'||c==="'"){quote=c;quoteStart=i;continue}
    if('([{'.includes(c))stack.push(c)
    else if(')]}'.includes(c)&&stack.pop()!==pairs[c])return 'mismatched delimiter'
  }
  return here?'unterminated here-string':quote?`unterminated string near ${JSON.stringify(source.slice(quoteStart,quoteStart+40))}`:stack.length?`unbalanced ${stack.at(-1)==='{'?'brace':'delimiter'}`:null
}

if (require.main === module) {
  const errors = verifyLinkedRuntimeInstallers()
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log('Linked runtime installer verification passed')
  }
}
