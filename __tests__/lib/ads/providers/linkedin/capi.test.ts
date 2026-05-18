// __tests__/lib/ads/providers/linkedin/capi.test.ts
import { createHash } from 'crypto'
import {
  composeConversionUrn,
  buildUserIds,
  buildConversionEventBody,
  trackConversion,
  type LinkedinConversionEventInput,
} from '@/lib/ads/providers/linkedin/capi'

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

const validInput: LinkedinConversionEventInput = {
  conversionId: '999',
  eventTimeMs: 1716985200000,
  user: { email: 'test@example.com', liFatId: 'abc' },
  eventId: 'evt-uuid-1',
}

// ─── composeConversionUrn ────────────────────────────────────────────────────

describe('composeConversionUrn', () => {
  it('builds URN from numeric id', () => {
    expect(composeConversionUrn('99')).toBe('urn:lla:llaPartnerConversion:99')
  })

  it('passes through full URN unchanged', () => {
    const urn = 'urn:lla:llaPartnerConversion:12345'
    expect(composeConversionUrn(urn)).toBe(urn)
  })
})

// ─── buildUserIds ────────────────────────────────────────────────────────────

describe('buildUserIds', () => {
  it('produces SHA256_EMAIL entry for email only', () => {
    const ids = buildUserIds({ email: 'Foo@bar.com' })
    expect(ids).toHaveLength(1)
    expect(ids[0]).toEqual({
      idType: 'SHA256_EMAIL',
      idValue: sha256Hex('foo@bar.com'),
    })
  })

  it('produces correct ordered entries for email + phone + liFatId', () => {
    const ids = buildUserIds({ email: 'u@ex.com', phone: '+27821234567', liFatId: 'li-fat-xyz' })
    expect(ids[0].idType).toBe('SHA256_EMAIL')
    expect(ids[0].idValue).toBe(sha256Hex('u@ex.com'))
    expect(ids[1].idType).toBe('SHA256_PHONE')
    expect(ids[1].idValue).toBe(sha256Hex('+27821234567'))
    expect(ids[2]).toEqual({ idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', idValue: 'li-fat-xyz' })
    expect(ids).toHaveLength(3)
  })

  it('throws when user object has no identifier', () => {
    expect(() => buildUserIds({})).toThrow('buildUserIds: at least one identifier')
  })

  it('silently drops empty/whitespace email + phone, keeps liFatId', () => {
    const ids = buildUserIds({ email: '   ', phone: '', liFatId: 'abc' })
    expect(ids).toHaveLength(1)
    expect(ids[0]).toEqual({ idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', idValue: 'abc' })
  })

  it('includes ACXIOM_ID and ORACLE_MOAT_ID when provided', () => {
    const ids = buildUserIds({
      email: 'a@b.com',
      phone: '+1234567890',
      liFatId: 'fat1',
      acxiomId: 'axm-001',
      oracleMoatId: 'orc-002',
    })
    expect(ids).toHaveLength(5)
    expect(ids[3]).toEqual({ idType: 'ACXIOM_ID', idValue: 'axm-001' })
    expect(ids[4]).toEqual({ idType: 'ORACLE_MOAT_ID', idValue: 'orc-002' })
  })
})

// ─── buildConversionEventBody ────────────────────────────────────────────────

describe('buildConversionEventBody', () => {
  it('includes conversion URN, conversionHappenedAt, user.userIds, and eventId', () => {
    const body = buildConversionEventBody(validInput)
    expect(body.conversion).toBe('urn:lla:llaPartnerConversion:999')
    expect(body.conversionHappenedAt).toBe(1716985200000)
    expect(body.eventId).toBe('evt-uuid-1')
    const user = body.user as { userIds: unknown[] }
    expect(Array.isArray(user.userIds)).toBe(true)
    expect(user.userIds.length).toBeGreaterThan(0)
  })

  it('includes conversionValue with decimal-string amount when value is passed', () => {
    const body = buildConversionEventBody({
      ...validInput,
      value: { amount: 99.99, currencyCode: 'USD' },
    })
    expect(body.conversionValue).toEqual({ currencyCode: 'USD', amount: '99.99' })
  })

  it('omits conversionValue when value is undefined', () => {
    const body = buildConversionEventBody({ ...validInput, value: undefined })
    expect(Object.prototype.hasOwnProperty.call(body, 'conversionValue')).toBe(false)
  })

  it('includes testEventCode when passed', () => {
    const body = buildConversionEventBody(validInput, 'TEST_CODE_123')
    expect(body.testEventCode).toBe('TEST_CODE_123')
  })

  it('omits testEventCode when not passed', () => {
    const body = buildConversionEventBody(validInput)
    expect(Object.prototype.hasOwnProperty.call(body, 'testEventCode')).toBe(false)
  })
})

// ─── trackConversion ─────────────────────────────────────────────────────────

describe('trackConversion', () => {
  it('POSTs to /rest/conversionEvents with all 4 required headers', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => '',
      json: async () => ({}),
    })

    await trackConversion({
      input: validInput,
      capiAccessToken: 'tok-abc',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/rest\/conversionEvents$/)
    expect(opts.method).toBe('POST')
    const headers = opts.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer tok-abc')
    expect(headers['LinkedIn-Version']).toBeTruthy()
    expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('throws on non-OK response with status + body excerpt in message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Invalid conversion id',
      json: async () => ({}),
    })

    await expect(
      trackConversion({ input: validInput, capiAccessToken: 'tok-bad', fetchImpl }),
    ).rejects.toThrow('LinkedIn conversionEvents POST failed: HTTP 400')
  })

  it('returns {ok: true, status} on 201 success', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => '',
      json: async () => ({}),
    })

    const result = await trackConversion({
      input: validInput,
      capiAccessToken: 'tok-ok',
      fetchImpl,
    })

    expect(result).toEqual({ ok: true, status: 201 })
  })
})
