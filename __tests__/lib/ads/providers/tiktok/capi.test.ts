// __tests__/lib/ads/providers/tiktok/capi.test.ts
// Phase 6 — TikTok Events API (server-side conversions) unit tests
// 10 tests covering buildEventBody + trackConversion

import { buildEventBody, trackConversion } from '@/lib/ads/providers/tiktok/capi'
import type { TiktokConversionEventInput } from '@/lib/ads/providers/tiktok/capi'

// ─── Test fixtures ────────────────────────────────────────────────────────────

const PIXEL_CODE = 'ABCDEFGHIJK'
const EVENT_ID = 'evt-smoke-001'
const EVENT_TIME_ISO = '2026-05-18T10:00:00.000Z'

const BASE_INPUT: TiktokConversionEventInput = {
  pixelCode: PIXEL_CODE,
  eventName: 'Purchase',
  eventId: EVENT_ID,
  eventTimeIso: EVENT_TIME_ISO,
  user: {
    email: 'Jane@Example.COM', // mixed case — should be lowercased before hashing
    phone: '+27 82 123 4567',
  },
  value: 149.99,
  currency: 'USD',
  contentId: 'prod_001',
  pageUrl: 'https://example.com/checkout',
}

// ─── Test 1: buildEventBody includes pixel_code + event + event_id + timestamp ─

describe('buildEventBody', () => {
  it('includes pixel_code, event, event_id, and timestamp in output', () => {
    const body = buildEventBody(BASE_INPUT)
    expect(body.pixel_code).toBe(PIXEL_CODE)
    expect(body.event).toBe('Purchase')
    expect(body.event_id).toBe(EVENT_ID)
    expect(body.timestamp).toBe(EVENT_TIME_ISO)
  })

  // ─── Test 2: hashes email + phone into context.user ───────────────────────

  it('SHA-256 hashes email and phone into context.user', () => {
    const body = buildEventBody(BASE_INPUT)
    const ctx = body.context as Record<string, unknown>
    const user = ctx.user as Record<string, unknown>

    // Email: 'jane@example.com' (lowercased + trimmed)
    // SHA-256('jane@example.com') = known reference hash
    const crypto = require('crypto')
    const expectedEmailHash = crypto
      .createHash('sha256')
      .update('jane@example.com', 'utf8')
      .digest('hex')

    expect(user.email).toBe(expectedEmailHash)
    expect(typeof user.phone_number).toBe('string')
    expect((user.phone_number as string).length).toBe(64) // SHA-256 hex = 64 chars
  })

  // ─── Test 3: hashes external_id ───────────────────────────────────────────

  it('SHA-256 hashes externalId into context.user.external_id', () => {
    const input: TiktokConversionEventInput = {
      ...BASE_INPUT,
      user: { ...BASE_INPUT.user, externalId: 'user_abc_123' },
    }
    const body = buildEventBody(input)
    const ctx = body.context as Record<string, unknown>
    const user = ctx.user as Record<string, unknown>

    const crypto = require('crypto')
    const expected = crypto
      .createHash('sha256')
      .update('user_abc_123', 'utf8')
      .digest('hex')

    expect(user.external_id).toBe(expected)
  })

  // ─── Test 4: ttclid in context.ad.callback (raw, not hashed) ─────────────

  it('places ttclid raw in context.ad.callback — not hashed', () => {
    const ttclid = 'CjAKEAiy_LiElMNcv8QvdABCD123'
    const input: TiktokConversionEventInput = {
      ...BASE_INPUT,
      user: { ...BASE_INPUT.user, ttclid },
    }
    const body = buildEventBody(input)
    const ctx = body.context as Record<string, unknown>
    const ad = ctx.ad as Record<string, unknown>

    expect(ad).toBeDefined()
    expect(ad.callback).toBe(ttclid) // raw, not hashed
  })

  // ─── Test 5: throws when no identifier present ────────────────────────────

  it('throws when no identifier (email/phone/externalId/ttclid/ttp) is provided', () => {
    const input: TiktokConversionEventInput = {
      ...BASE_INPUT,
      user: {}, // empty — no identifier
    }
    expect(() => buildEventBody(input)).toThrow(/identifier/)
  })

  // ─── Test 6: properties: value + currency + content_id when provided ──────

  it('includes value, currency, and content_id in properties when provided', () => {
    const body = buildEventBody(BASE_INPUT)
    const props = body.properties as Record<string, unknown>

    expect(props).toBeDefined()
    expect(props.value).toBe(149.99)
    expect(props.currency).toBe('USD')
    expect(props.content_id).toBe('prod_001')
  })

  // ─── Test 7: omits test_event_code when not passed; includes when passed ──

  it('omits test_event_code when not passed and includes it when passed', () => {
    const bodyWithout = buildEventBody(BASE_INPUT)
    expect(bodyWithout.test_event_code).toBeUndefined()

    const bodyWith = buildEventBody(BASE_INPUT, 'TEST99999')
    expect(bodyWith.test_event_code).toBe('TEST99999')
  })
})

// ─── trackConversion tests ────────────────────────────────────────────────────

describe('trackConversion', () => {
  // ─── Test 8: POSTs to /pixel/track/ with correct headers ─────────────────

  it('POSTs to /pixel/track/ with Access-Token and Content-Type: application/json', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: 'OK' }),
    } as unknown as Response)

    await trackConversion({
      capiAccessToken: 'test-events-api-token',
      input: BASE_INPUT,
      fetchImpl: mockFetch,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]

    expect(url).toMatch(/\/pixel\/track\/$/)
    expect((init.headers as Record<string, string>)['Access-Token']).toBe('test-events-api-token')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.method).toBe('POST')
  })

  // ─── Test 9: throws when code !== 0 ──────────────────────────────────────

  it('throws when the API returns code !== 0', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 40001, message: 'Invalid Access Token' }),
    } as unknown as Response)

    await expect(
      trackConversion({
        capiAccessToken: 'bad-token',
        input: BASE_INPUT,
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow(/code=40001/)
  })

  // ─── Test 10: throws on HTTP non-ok ──────────────────────────────────────

  it('throws on HTTP non-ok (e.g. 401 Unauthorized)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as unknown as Response)

    await expect(
      trackConversion({
        capiAccessToken: 'bad-token',
        input: BASE_INPUT,
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow(/HTTP 401/)
  })
})
