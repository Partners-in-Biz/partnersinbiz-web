import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-media.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

describe('isPrivateIpLiteral', () => {
  it('flags loopback, RFC1918, link-local, CGNAT and local names', () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '172.16.9.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', 'localhost', 'metadata.internal', 'printer.local']) {
      expect(runModule<boolean>(`return m.isPrivateIpLiteral(${JSON.stringify(host)})`)).toBe(true)
    }
  })

  it('passes public names and public IPs, which the allowlist still rejects', () => {
    expect(runModule<boolean>("return m.isPrivateIpLiteral('firebasestorage.googleapis.com')")).toBe(false)
    expect(runModule<boolean>("return m.isPrivateIpLiteral('8.8.8.8')")).toBe(false)
    expect(runModule<boolean>("return m.isPrivateIpLiteral('172.32.0.1')")).toBe(false)
  })
})

describe('assertAllowedMediaUrl', () => {
  it('allows Firebase Storage, GCS, the platform, and provider CDN suffixes', () => {
    expect(runModule<string[]>('return m.DEFAULT_ALLOWED_MEDIA_HOSTS')).toContain('firebasestorage.googleapis.com')
    for (const url of [
      'https://firebasestorage.googleapis.com/v0/b/x/o/a.mp4?alt=media',
      'https://storage.googleapis.com/bucket/a.mp4',
      'https://partnersinbiz.online/media/a.mp4',
      'https://d1abc123.cloudfront.net/render/a.mp4',
      'https://cdn.higgsfield.ai/out/a.mp4',
      'https://v3.fal.media/files/a.mp4',
    ]) {
      expect(runModule<string>(`return m.assertAllowedMediaUrl(${JSON.stringify(url)}).href`)).toBe(url)
    }
  })

  it('honors extraHosts and rejects unsafe URLs', () => {
    expect(runModule<string>(`
      try { m.assertAllowedMediaUrl('https://media.example.com/a.mp4') } catch (error) { return String(error.message) }
    `)).toContain('allowlist')
    expect(runModule<string>(`
      return m.assertAllowedMediaUrl('https://media.example.com/a.mp4', { extraHosts: ['media.example.com'] }).hostname
    `)).toBe('media.example.com')
    for (const [url, message] of [
      ['http://firebasestorage.googleapis.com/a.mp4', 'https'],
      ['https://user:pass@firebasestorage.googleapis.com/a.mp4', 'credentials'],
      ['https://169.254.169.254/latest/meta-data', 'IP literal'],
      ['https://8.8.8.8/a.mp4', 'IP literal'],
      ['not a url', 'invalid media url'],
    ]) {
      expect(runModule<string>(`
        try { m.assertAllowedMediaUrl(${JSON.stringify(url)}) } catch (error) { return String(error.message) }
      `)).toContain(message)
    }
  })
})
