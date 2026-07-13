import fs from 'node:fs'
import path from 'node:path'

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
const docs = read('runtime-installers/README.md')
const structural = validatePowerShellStructure(win); if(structural) errors.push(`Windows PowerShell: ${structural}`)

const runtimeCli=read('runtime-installers/runtime/cli.ts')
const runtime=['client.ts','worker.ts','core.ts','bridge.ts','release-manager.ts'].map(file=>read(`runtime-installers/runtime/${file}`)).concat(runtimeCli).join('\n')
for (const [name, source] of [['macOS', mac+runtime], ['Windows', win+runtime]] as const) {
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

requireText('macOS', mac, /security (?:add|find)-generic-password/)
requireText('macOS', mac, /launchctl (?:bootstrap|bootout|kickstart)/)
requireText('macOS plist', plist, /com\.partnersinbiz\.runtime/)
requireText('macOS plist', plist, /KeepAlive/)
requireText('Windows', win, /CredWrite|Credential Manager/)
requireText('runtime service', runtime, /pollForever/)
rejectText('runtime service', runtime, /createServer|\.listen\s*\(/)
requireText('runtime signed client', read('runtime-installers/runtime/client.ts'), /x-device-signature/)
requireText('macOS release manager', mac, /RELEASE_MANAGER[\s\S]*verify/)
requireText('Windows release manager', win, /releaseArgs=[\s\S]*'verify'[\s\S]*& \$ReleaseManager @releaseArgs/)
requireText('build matrix', read('runtime-installers/build-runtime.sh'), /macos-arm64 macos-x64 windows-arm64 windows-x64/)
requireText('compiled runtime matrix', read('runtime-installers/build-runtime.sh'), /bun build --compile/)
requireText('native Windows matrix', read('runtime-installers/build-runtime.sh'), /dotnet publish[\s\S]*win-x64[\s\S]*win-arm64/)
requireText('Windows', win, /sc\.exe create PartnersInBizRuntime/)
requireText('Windows service', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /ServiceBase/)
requireText('Windows worker supervision', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /Supervise\(stopping\.Token\)/)
requireText('Windows worker restart', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /WaitForExit\(500\)[\s\S]*restarting/)
requireText('Windows clean service stop', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /stopping\?\.Cancel\(\)[\s\S]*supervisor\?\.Join/)
requireText('Windows service identity', win, /obj= LocalSystem/)
requireText('Windows DPAPI handoff', win, /DataProtectionScope]::LocalMachine/)
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
requireText('Windows force-local warning',win,/ForceLocal[\s\S]*FORCE LOCAL/)
requireText('macOS revoke-only retention',mac,/Remote revoke pending[\s\S]*revoke-only recovery mode/)
requireText('Windows unsigned marker', win, /\.unsigned-dev/)
requireText('Windows rollback stop fence', win, /Rollback-Runtime[\s\S]*sc\.exe stop[\s\S]*Wait-ServiceStopped/)

// The browser handoff is deliberately a non-secret command contract.
const safeCommands = [
  'pib-runtime pair --challenge challenge_123 --platform macos',
  'pib-runtime pair --challenge challenge_123 --platform windows',
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
