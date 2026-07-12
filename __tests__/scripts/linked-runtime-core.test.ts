import { generateKeyPairSync, sign } from 'node:crypto'
import { canonicalJson, redactLog, verifyRelease, createReceipt, revokeAndCleanup } from '../../runtime-installers/runtime/core'
import { activateRelease, rollbackRelease } from '../../runtime-installers/runtime/release'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'

describe('linked runtime executable core', () => {
  const keys = generateKeyPairSync('ed25519')
  const payload = Buffer.from('runtime')
  const base = { channel: 'stable', platform: 'macos', architecture: 'arm64', version: '2.1.0', minimumVersion: '2.0.0', sha256: '' }
  it('rejects bad signature, hash, architecture and minimum version', () => {
    const crypto = require('node:crypto'); const manifest = { ...base, sha256: crypto.createHash('sha256').update(payload).digest('hex') }
    const signature = sign(null, Buffer.from(canonicalJson(manifest)), keys.privateKey).toString('base64url')
    expect(() => verifyRelease(manifest, signature + 'x', payload, keys.publicKey, { platform: 'macos', architecture: 'arm64', currentVersion: '2.0.0' })).toThrow()
    expect(() => verifyRelease(manifest, signature, Buffer.from('bad'), keys.publicKey, { platform: 'macos', architecture: 'arm64', currentVersion: '2.0.0' })).toThrow(/hash/)
    expect(() => verifyRelease(manifest, signature, payload, keys.publicKey, { platform: 'macos', architecture: 'x64', currentVersion: '2.0.0' })).toThrow(/architecture/)
    expect(() => verifyRelease({ ...manifest, minimumVersion: '3.0.0' }, signature, payload, keys.publicKey, { platform: 'macos', architecture: 'arm64', currentVersion: '2.0.0' })).toThrow()
  })
  it('verifies the checked-in build/package fixture',()=>{const f=JSON.parse(fs.readFileSync('runtime-installers/fixtures/release-valid.json','utf8')),publicKey=fs.readFileSync('runtime-installers/fixtures/release-public.pem');const {signature,payload,...manifest}=f;expect(()=>verifyRelease(manifest,signature,Buffer.from(payload,'base64'),publicKey,{platform:'windows',architecture:'x64',currentVersion:'1.0.0'})).not.toThrow()})
  it('signs canonical receipts and redacts secrets', () => {
    const receipt = createReceipt({ deviceId:'d', targetId:'t', machineLabel:'m', acceptedAt:'a', toolStartedAt:'b', runtimeVersion:'1', outcome:'completed' }, keys.privateKey)
    expect(receipt.signature).toBeTruthy(); expect(redactLog('credential=abc transportToken=xyz pairingCode=123')).not.toMatch(/abc|xyz|123/)
  })
  it('cleans locally when remote revoke is offline', async () => {
    const cleanup = jest.fn(); await expect(revokeAndCleanup(async()=>{throw new Error('offline')}, cleanup)).resolves.toEqual({ remoteRevokePending: true }); expect(cleanup).toHaveBeenCalled()
  })
  it('atomically activates and re-verifies a signed previous release before rollback', () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pib-release-')), current=path.join(dir,'runtime')
    const mk=(body:string,version:string)=>{const bytes=Buffer.from(body),manifest={...base,version,minimumVersion:'1.0.0',sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')};return{bytes,manifest,signature:sign(null,Buffer.from(canonicalJson(manifest)),keys.privateKey).toString('base64url')}}
    const old=mk('old','2.0.0');activateRelease(dir,old,keys.publicKey,{platform:'macos',architecture:'arm64',currentVersion:'2.0.0'});const next=mk('new','2.1.0');activateRelease(dir,next,keys.publicKey,{platform:'macos',architecture:'arm64',currentVersion:'2.0.0'});expect(fs.readFileSync(current,'utf8')).toBe('new')
    rollbackRelease(dir,keys.publicKey,{platform:'macos',architecture:'arm64',currentVersion:'2.1.0'});expect(fs.readFileSync(current,'utf8')).toBe('old')
    expect(()=>rollbackRelease(fs.mkdtempSync(path.join(os.tmpdir(),'pib-empty-')),keys.publicKey,{platform:'macos',architecture:'arm64',currentVersion:'2.0.0'})).toThrow(/previous/)
  })
})
