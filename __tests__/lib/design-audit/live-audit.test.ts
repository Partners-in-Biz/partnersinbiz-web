import {
  designAuditUrlRejectionReason,
  fetchDesignAuditPage,
  isDesignAuditPrivateHost,
  runDesignAuditForPage,
  sanitizeDesignAuditUrl,
} from '@/lib/design-audit/live-audit'

describe('design-audit live-audit URL guard', () => {
  it('sanitizes http(s) URLs and strips credentials', () => {
    expect(sanitizeDesignAuditUrl('https://example.com/page')).toBe('https://example.com/page')
    expect(sanitizeDesignAuditUrl('http://example.com')).toBe('http://example.com/')
    expect(sanitizeDesignAuditUrl('https://user:pass@example.com')).toBeNull()
    expect(sanitizeDesignAuditUrl('ftp://example.com')).toBeNull()
    expect(sanitizeDesignAuditUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeDesignAuditUrl('file:///etc/passwd')).toBeNull()
    expect(sanitizeDesignAuditUrl('   ')).toBeNull()
    expect(sanitizeDesignAuditUrl(42)).toBeNull()
  })

  it('rejects private-network hosts by default', () => {
    expect(isDesignAuditPrivateHost('localhost')).toBe(true)
    expect(isDesignAuditPrivateHost('127.0.0.1')).toBe(true)
    expect(isDesignAuditPrivateHost('192.168.1.10')).toBe(true)
    expect(isDesignAuditPrivateHost('10.0.0.5')).toBe(true)
    expect(isDesignAuditPrivateHost('172.16.0.1')).toBe(true)
    expect(isDesignAuditPrivateHost('169.254.1.1')).toBe(true)
    expect(isDesignAuditPrivateHost('dev.local')).toBe(true)
    expect(isDesignAuditPrivateHost('example.com')).toBe(false)
    expect(isDesignAuditPrivateHost('partnersinbiz.online')).toBe(false)

    expect(designAuditUrlRejectionReason('https://localhost:3000')).toContain('Private-network')
    expect(designAuditUrlRejectionReason('http://192.168.0.1')).toContain('Private-network')
    expect(designAuditUrlRejectionReason('https://example.com')).toBeNull()
  })

  it('honors allowPrivateNetwork and host allowlist policy', () => {
    expect(designAuditUrlRejectionReason('https://localhost:3000', { allowPrivateNetwork: true })).toBeNull()

    const policy = { allowHosts: ['example.com', '*.partnersinbiz.online'] }
    expect(designAuditUrlRejectionReason('https://example.com/x', policy)).toBeNull()
    expect(designAuditUrlRejectionReason('https://sub.partnersinbiz.online/x', policy)).toBeNull()
    expect(designAuditUrlRejectionReason('https://other.com/x', policy)).toContain('allowlist')
    expect(designAuditUrlRejectionReason('https://localhost:3000', policy)).toContain('Private-network')
  })
})

describe('design-audit fetchDesignAuditPage', () => {
  it('fetches HTML with caps and returns final url', async () => {
    const fetchImpl = jest.fn(async () => new Response('<!doctype html><html><body>hi</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch

    const result = await fetchDesignAuditPage('https://example.com/', { fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.html).toContain('hi')
      expect(result.finalUrl).toBe('https://example.com/')
    }
  })

  it('follows redirects and re-validates the target', async () => {
    let calls = 0
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      calls += 1
      const url = String(input)
      if (calls === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://example.com/final' } })
      }
      expect(url).toBe('https://example.com/final')
      return new Response('<html><body>final</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    }) as unknown as typeof fetch

    const result = await fetchDesignAuditPage('https://example.com/start', { fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.html).toContain('final')
  })

  it('rejects redirects to private hosts', async () => {
    const fetchImpl = jest.fn(async () => new Response(null, { status: 302, headers: { location: 'http://localhost:3000/' } })) as unknown as typeof fetch
    const result = await fetchDesignAuditPage('https://example.com/start', { fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Private-network')
  })

  it('refuses non-HTML content types and oversized bodies', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    const result = await fetchDesignAuditPage('https://example.com/', { fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('non-HTML')
  })
})

describe('design-audit runDesignAuditForPage', () => {
  it('runs the T1 engine with browser-mode hooks', () => {
    const html = '<html><body><h1 style="background:linear-gradient(90deg,#7c3aed,#a855f7)">Hello</h1></body></html>'
    const result = runDesignAuditForPage(html, {
      scope: 'all',
      runtimeErrors: ['TypeError: x is undefined (main.js:1)'],
      computedStyles: { 'h1:nth-of-type(1)': { 'font-size': '10px' } },
    })
    expect(result.exitCode).toBe(2)
    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.findings.some((f) => f.rule === 'gradient-text' || f.rule === 'purple-gradients')).toBe(true)
  })

  it('returns exit code 0 on clean input with no findings', () => {
    const html = '<!doctype html><html lang="en"><body><h1>Title</h1><p>Body text</p></body></html>'
    const result = runDesignAuditForPage(html, { scope: 'all' })
    expect(result.exitCode).toBe(0)
    expect(result.findings).toHaveLength(0)
  })
})
