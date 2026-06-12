import { checkOutboundLink, extractOutboundLinks, validateOutboundLinks } from '@/lib/social/outbound-link-validation'

describe('social outbound link validation', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('extracts naked Partners in Biz URLs from CTA copy', () => {
    expect(extractOutboundLinks('Start a project: partnersinbiz.online\nBook: partnersinbiz.online/contact.')).toEqual([
      'https://partnersinbiz.online',
      'https://partnersinbiz.online/contact',
    ])
  })

  it('blocks definite missing links', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as jest.Mock

    const result = await validateOutboundLinks('Book: partnersinbiz.online/contact')

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toContain('https://partnersinbiz.online/contact')
  })

  it('falls back from HEAD to GET before blocking', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('HEAD failed'))
      .mockResolvedValueOnce({ ok: true, status: 200 }) as jest.Mock

    const result = await checkOutboundLink('https://partnersinbiz.online/book-a-call')

    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not block on common anti-bot statuses', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as jest.Mock

    const result = await validateOutboundLinks('Read: https://example.com/private')

    expect(result.valid).toBe(true)
  })
})
