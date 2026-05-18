// __tests__/lib/ads/conversions/track-tiktok.test.ts
// Phase 6 — TikTok fanout arm tests for trackConversion()
// 5 tests

import { trackConversion } from '@/lib/ads/conversions/track'
import type { ConversionEventInput } from '@/lib/ads/conversions/types'
import type { AdConversionAction, AdPixelConfig } from '@/lib/ads/types'
import type { Timestamp } from 'firebase-admin/firestore'

// ─── Mock: firebase/admin (adminDb) ────────────────────────────────────────────

const mockDedupeGet = jest.fn()
const mockDedupeSet = jest.fn()
const mockActionGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => {
        if (name === 'ad_conversion_events') {
          return { get: mockDedupeGet, set: mockDedupeSet }
        }
        if (name === 'ad_conversion_actions') {
          return { get: mockActionGet }
        }
        return { get: jest.fn().mockResolvedValue({ exists: false, data: () => undefined }) }
      },
    }),
  },
}))

// ─── Mock: Meta CAPI (should NOT be called for tiktok actions) ───────────────

const mockMetaCapiTrackConversion = jest.fn()

jest.mock('@/lib/ads/capi/track', () => ({
  trackConversion: (...args: unknown[]) => mockMetaCapiTrackConversion(...args),
}))

// ─── Mock: Google connections ─────────────────────────────────────────────────

jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn(),
}))

jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn(),
}))

jest.mock('@/lib/ads/providers/google/conversions', () => ({
  uploadEnhancedConversions: jest.fn(),
}))

// ─── Mock: LinkedIn CAPI ──────────────────────────────────────────────────────

jest.mock('@/lib/ads/providers/linkedin/capi', () => ({
  trackConversion: jest.fn(),
}))

// ─── Mock: TikTok CAPI ───────────────────────────────────────────────────────

const mockTiktokTrackConversion = jest.fn()

jest.mock('@/lib/ads/providers/tiktok/capi', () => ({
  trackConversion: (...args: unknown[]) => mockTiktokTrackConversion(...args),
}))

// ─── Mock: pixel-configs/store ───────────────────────────────────────────────

const mockListPixelConfigs = jest.fn()
const mockDecryptPlatformCapiToken = jest.fn()

jest.mock('@/lib/ads/pixel-configs/store', () => ({
  listPixelConfigs: (...args: unknown[]) => mockListPixelConfigs(...args),
  decryptPlatformCapiToken: (...args: unknown[]) => mockDecryptPlatformCapiToken(...args),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org_tiktok_01'
const ACTION_ID = 'ca_tiktok_01'
const EVENT_ID = 'evt_tiktok_abc'
const PIXEL_CODE = 'ABCDEFGHIJK'
const PIXEL_CONFIG_ID = 'pxc_tiktok_01'

const BASE_INPUT: ConversionEventInput = {
  orgId: ORG_ID,
  conversionActionId: ACTION_ID,
  eventId: EVENT_ID,
  eventTime: new Date('2026-05-18T10:00:00.000Z'),
  value: 199.99,
  currency: 'USD',
  user: {
    email: 'smoke@example.com',
    phone: '+27821234567',
  },
  ttclid: 'CjAKEAiy_LiElMNcv8QvdABCD123',
}

function makeTiktokAction(overrides: Partial<AdConversionAction> = {}): AdConversionAction {
  return {
    id: ACTION_ID,
    orgId: ORG_ID,
    platform: 'tiktok',
    name: 'TikTok Purchase',
    category: 'PURCHASE',
    valueSettings: {},
    countingType: 'ONE_PER_CLICK',
    providerData: {
      tiktok: { eventName: 'Purchase' },
    },
    createdAt: {} as Timestamp,
    updatedAt: {} as Timestamp,
    ...overrides,
  }
}

function makePixelConfig(tiktokOverrides: Partial<NonNullable<AdPixelConfig['tiktok']>> = {}): AdPixelConfig {
  return {
    id: PIXEL_CONFIG_ID,
    orgId: ORG_ID,
    name: 'TikTok Pixel',
    tiktok: {
      pixelId: PIXEL_CODE,
      capiTokenEnc: { ciphertext: 'ct', iv: 'iv', tag: 'tag' },
      testEventCode: 'TEST12345',
      ...tiktokOverrides,
    },
    eventMappings: [],
    createdBy: 'admin',
    createdAt: {} as Timestamp,
    updatedAt: {} as Timestamp,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('trackConversion — TikTok fanout arm (Phase 6)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDedupeGet.mockResolvedValue({ exists: false })
    mockDedupeSet.mockResolvedValue(undefined)
    mockTiktokTrackConversion.mockResolvedValue({ ok: true, status: 200 })
    mockListPixelConfigs.mockResolvedValue([makePixelConfig()])
    mockDecryptPlatformCapiToken.mockReturnValue('decrypted-tiktok-events-api-token')
  })

  // ─── Test 11: TikTok action dispatches to TikTok trackConversion ─────────

  it('TikTok-platform action dispatches to TikTok trackConversion — meta/google/linkedin not called', async () => {
    mockActionGet.mockResolvedValue({ exists: true, data: () => makeTiktokAction() })

    const result = await trackConversion(BASE_INPUT)

    expect(result.tiktok).toBe('sent')
    expect(result.meta).toBeUndefined()
    expect(result.google).toBeUndefined()
    expect(result.linkedin).toBeUndefined()

    expect(mockTiktokTrackConversion).toHaveBeenCalledTimes(1)
    expect(mockMetaCapiTrackConversion).not.toHaveBeenCalled()

    // Verify key call args
    const [callArgs] = mockTiktokTrackConversion.mock.calls
    expect(callArgs[0].capiAccessToken).toBe('decrypted-tiktok-events-api-token')
    expect(callArgs[0].testEventCode).toBe('TEST12345')
    expect(callArgs[0].input.pixelCode).toBe(PIXEL_CODE)
    expect(callArgs[0].input.eventName).toBe('Purchase')
    expect(callArgs[0].input.eventId).toBe(EVENT_ID)
    expect(callArgs[0].input.user.email).toBe('smoke@example.com')
    expect(callArgs[0].input.user.phone).toBe('+27821234567')
    expect(callArgs[0].input.user.ttclid).toBe('CjAKEAiy_LiElMNcv8QvdABCD123')
    expect(callArgs[0].input.value).toBe(199.99)
    expect(callArgs[0].input.currency).toBe('USD')

    // decryptPlatformCapiToken called with (config, 'tiktok')
    expect(mockDecryptPlatformCapiToken).toHaveBeenCalledTimes(1)
    expect(mockDecryptPlatformCapiToken.mock.calls[0][1]).toBe('tiktok')
  })

  // ─── Test 12: Dedupe — same eventId returns cached result ────────────────

  it('re-firing same eventId returns cached dedupe result without re-dispatching', async () => {
    mockDedupeGet.mockResolvedValue({
      exists: true,
      data: () => ({ tiktok: 'sent', orgId: ORG_ID }),
    })

    const result = await trackConversion(BASE_INPUT)

    expect(result.tiktok).toBe('sent')
    expect(mockActionGet).not.toHaveBeenCalled()
    expect(mockTiktokTrackConversion).not.toHaveBeenCalled()
    expect(mockListPixelConfigs).not.toHaveBeenCalled()
  })

  // ─── Test 13: result includes tiktok:'sent' on success ───────────────────

  it('result includes tiktok:"sent" on successful dispatch', async () => {
    mockActionGet.mockResolvedValue({ exists: true, data: () => makeTiktokAction() })

    const result = await trackConversion(BASE_INPUT)

    expect(result.tiktok).toBe('sent')
    expect(result.tiktokError).toBeUndefined()

    // Dedupe persisted with tiktok: 'sent'
    expect(mockDedupeSet).toHaveBeenCalledTimes(1)
    const [setData] = mockDedupeSet.mock.calls[0]
    expect(setData.tiktok).toBe('sent')
    expect(setData.platform).toBe('tiktok')
    expect(setData.orgId).toBe(ORG_ID)
  })

  // ─── Test 14: result includes tiktok:'failed' + tiktokError on throw ─────

  it('result includes tiktok:"failed" and tiktokError when provider throws', async () => {
    mockActionGet.mockResolvedValue({ exists: true, data: () => makeTiktokAction() })
    mockTiktokTrackConversion.mockRejectedValue(
      new Error('TikTok Events API error: code=40001 message=Invalid Access Token'),
    )

    const result = await trackConversion(BASE_INPUT)

    expect(result.tiktok).toBe('failed')
    expect(result.tiktokError).toContain('code=40001')

    expect(mockDedupeSet).toHaveBeenCalledTimes(1)
    const [setData] = mockDedupeSet.mock.calls[0]
    expect(setData.tiktok).toBe('failed')
  })

  // ─── Test 15: marks failed when pixel config missing pixelCode or capiTokenEnc ─

  it('marks tiktok:failed when pixel config is missing pixelCode — error mentions admin', async () => {
    mockActionGet.mockResolvedValue({ exists: true, data: () => makeTiktokAction() })
    // Config with tiktok slot but no pixelId/pixelCode
    mockListPixelConfigs.mockResolvedValue([
      makePixelConfig({ pixelId: undefined }),
    ])

    const result = await trackConversion(BASE_INPUT)

    expect(result.tiktok).toBe('failed')
    expect(result.tiktokError).toContain('pixelCode')
    expect(result.tiktokError).toContain('admin')
    expect(mockTiktokTrackConversion).not.toHaveBeenCalled()
  })
})
