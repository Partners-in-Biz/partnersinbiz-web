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

for (const [name, source] of [['macOS', mac], ['Windows', win]] as const) {
  requireText(name, source, /challengeId/i)
  requireText(name, source, /pair/i)
  requireText(name, source, /heartbeat/i)
  requireText(name, source, /bootstrapTransport/i)
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

requireText('macOS', mac, /security (?:add|find)-generic-password/)
requireText('macOS', mac, /launchctl (?:bootstrap|bootout|kickstart)/)
requireText('macOS plist', plist, /com\.partnersinbiz\.runtime/)
requireText('macOS plist', plist, /KeepAlive/)
requireText('Windows', win, /CredWrite|Credential Manager/)
requireText('Windows', win, /sc\.exe create PartnersInBizRuntime/)
requireText('Windows service', read('runtime-installers/windows/PartnersInBizRuntimeService.cs'), /ServiceBase/)
requireText('documentation', docs, /UNSIGNED DEVELOPMENT MODE/)
requireText('documentation', docs, /signed and notarised/i)
requireText('macOS', mac, /PIB_ALLOW_UNSIGNED_DEV/)
requireText('Windows', win, /AllowUnsignedDev/)

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

if (require.main === module) {
  const errors = verifyLinkedRuntimeInstallers()
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log('Linked runtime installer verification passed')
  }
}
