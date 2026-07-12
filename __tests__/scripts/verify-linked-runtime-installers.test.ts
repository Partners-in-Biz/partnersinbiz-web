import { verifyLinkedRuntimeInstallers,validatePowerShellStructure } from '../../scripts/verify-linked-runtime-installers'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

describe('linked runtime installer verifier', () => {
  it('accepts only installers that satisfy the pairing, secret-storage, service, update and lifecycle contract', () => {
    expect(verifyLinkedRuntimeInstallers()).toEqual([])
  })
  it('fallback parser handles comments, escaped/doubled quotes, here strings and all delimiters',()=>{expect(validatePowerShellStructure("function x { 'oops")).toMatch(/string/);expect(validatePowerShellStructure('function x {')).toMatch(/brace/);expect(validatePowerShellStructure('function x { # } ignored\n $x=@\"\n{[(quoted)]}\n\"@; Write-Host \"a`\"b\"; Write-Host \'it\'\'s\' }')).toBeNull();expect(validatePowerShellStructure('function x { [abc) }')).toMatch(/delimiter/);expect(validatePowerShellStructure("@'\nnever closed")).toMatch(/here-string/)})
  it('executes signed and explicitly unsigned macOS lifecycle transitions',()=>{const result=spawnSync('bash',['runtime-installers/tests/macos-lifecycle.sh'],{encoding:'utf8'});expect(result.status).toBe(0);expect(result.stderr).not.toMatch(/production accepted|manifest\.json\.sig/)})
  it('atomically replaces an existing Keychain credential with add-only fallback',()=>{const source=fs.readFileSync('runtime-installers/macos/CredentialHelper.swift','utf8'),put=source.slice(source.indexOf('if arguments[1]=="put"'),source.indexOf('if arguments[1]=="get"'));expect(put).toMatch(/SecItemUpdate/);expect(put).toMatch(/errSecItemNotFound/);expect(put).toMatch(/SecItemAdd/);expect(put).not.toMatch(/SecItemDelete/);expect(put).toMatch(/read\(account\)==data/)})
})
