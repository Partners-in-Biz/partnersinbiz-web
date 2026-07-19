import { generateKeyPairSync, verify } from 'node:crypto'
import { canonicalJson } from '@/runtime-installers/runtime/core'
import { createRuntimeReleaseManifest, runtimeReleaseAssetNames } from '@/scripts/package-linked-runtime-release'

describe('linked runtime release publisher', () => {
  it('creates stable, architecture-specific asset names', () => {
    expect(runtimeReleaseAssetNames('linux-arm64')).toEqual({
      payload: 'partnersinbiz-runtime-linux-arm64',
      metadata: 'partnersinbiz-runtime-linux-arm64-stable.json',
      signature: 'partnersinbiz-runtime-linux-arm64-stable.json.sig',
      installer: 'partnersinbiz-runtime-linux-arm64-installer.tgz',
    })
    expect(runtimeReleaseAssetNames('macos-arm64').installer).toBe('partnersinbiz-runtime-macos-arm64-installer.pkg')
    expect(runtimeReleaseAssetNames('windows-x64').payload).toBe('partnersinbiz-runtime-windows-x64.exe')
    expect(runtimeReleaseAssetNames('windows-x64').installer).toBe('partnersinbiz-runtime-windows-x64-installer.cab')
  })

  it('binds a release manifest to the platform, payload hash and pinned release URL', () => {
    const payload = Buffer.from('runtime')
    const manifest = createRuntimeReleaseManifest({
      target: 'linux-x64', version: '1.1.1', minimumVersion: '1.1.1', payload,
      payloadUrl: 'https://github.com/Partners-in-Biz/partnersinbiz-web/releases/download/runtime-v1.1.1/partnersinbiz-runtime-linux-x64',
    })
    expect(manifest).toMatchObject({ channel: 'stable', platform: 'linux', architecture: 'x64', version: '1.1.1' })
    expect(manifest.sha256).toHaveLength(64)
    const keys = generateKeyPairSync('ed25519')
    const signature = require('node:crypto').sign(null, Buffer.from(canonicalJson(manifest)), keys.privateKey)
    expect(verify(null, Buffer.from(canonicalJson(manifest)), keys.publicKey, signature)).toBe(true)
  })

  it('refuses malformed release versions', () => {
    expect(() => createRuntimeReleaseManifest({
      target: 'linux-x64', version: 'latest', minimumVersion: '1.1.1', payload: Buffer.from('x'), payloadUrl: 'https://example.test/x',
    })).toThrow(/SemVer/)
  })
})
