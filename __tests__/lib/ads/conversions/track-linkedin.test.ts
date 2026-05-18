// __tests__/lib/ads/conversions/track-linkedin.test.ts
// Phase 5 Batch 2A — LinkedIn fanout arm tests
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

// ─── Mock: lib/ads/capi/track (Meta — should NOT be called for linkedin actions) ─

const mockMetaCapiTrackConversion = jest.fn()

jest.mock('@/lib/ads/capi/track', () => ({
  trackConversion: (...args: unknown[]) => mockMetaCapiTrackConversion(...args),
}))

// ─── Mock: lib/ads/connections/store ─────────────────────────────────────────

jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn(),
}))

// ─── Mock: lib/integrations/google_ads/oauth ─────────────────────────────────

jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn(),
}))

// ─── Mock: lib/ads/providers/google/conversions ──────────────────────────────

jest.mock('@/lib/ads/providers/google/conversions', () => ({
  uploadEnhancedConversions: jest.fn(),
}))

// ─── Mock: LinkedIn CAPI provider ────────────────────────────────────────────

const mockLinkedinTrackConversion = jest.fn()

jest.mock('@/lib/ads/providers/linkedin/capi', () => ({
  trackConversion: (...args: unknown[]) => mockLinkedinTrackConversion(...args),
}))

// ─── Mock: pixel-configs/store ───────────────────────────────────────────────

const mockListPixelConfigs = jest.fn()
const mockDecryptPlatformCapiToken = jest.fn()

jest.mock('@/lib/ads/pixel-configs/store', () => ({
  listPixelConfigs: (...args: unknown[]) => mockListPixelConfigs(...args),
  decryptPlatformCapiToken: (...args: unknown[]) => mockDecryptPlatformCapiToken(...args),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org_linkedin_01'
const ACTION_ID = 'ca_linkedin_01'
const EVENT_ID = 'evt_linkedin_abc'
const CONVERSION_URN = 'urn:lla:llaPartnerConversion:987654321'
const PIXEL_CONFIG_ID = 'pxc_linkedin_01'

const BASE_INPUT: ConversionEventInput = {
  orgId: ORG_ID,
  conversionActionId: ACTION_ID,
  eventId: EVENT_ID,
  eventTime: new Date('2026-05-18T10:00:00.000Z'),
  value: 299.99,
  currency: 'USD',
  user: {
    email: 'jane@example.com',
    phone: '+27821234567',
  },
  liFatId: 'AQFBFXi7_LiElMNcv8QvdA',
}

function makeLinkedinAction(overrides: Partial<AdConversionAction> = {}): AdConversionAction {
  return {
    id: ACTION_ID,
    orgId: ORG_ID,
    platform: 'linkedin',
    name: 'LinkedIn Purchase',
    category: 'PURCHASE',
    valueSettings: {},
    countingType: 'ONE_PER_CLICK',
    providerData: {
      linkedin: { conversionUrn: CONVERSION_URN },
    },
    createdAt: {} as Timestamp,
    updatedAt: {} as Timestamp,
    ...overrides,
  }
}

function makePixelConfig(linkedinOverrides: Partial<AdPixelConfig['linkedin']> = {}): AdPixelConfig {
  return {
    id: PIXEL_CONFIG_ID,
    orgId: ORG_ID,
    name: 'LinkedIn Pixel',
    linkedin: {
      pixelId: 'px_li_123',
      capiTokenEnc: { ciphertext: 'ciphertext_x', iv: 'iv_y', tag: 'tag_z' },
      testEventCode: 'TEST123',
      ...linkedinOverrides,
    },
    eventMappings: [],
    createdBy: 'admin',
    createdAt: {} as Timestamp,
    updatedAt: {} as Timestamp,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('trackConversion — LinkedIn fanout arm (Phase 5 Batch 2A)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDedupeGet.mockResolvedValue({ exists: false })
    mockDedupeSet.mockResolvedValue(undefined)
    mockLinkedinTrackConversion.mockResolvedValue({ ok: true, status: 201 })
    mockListPixelConfigs.mockResolvedValue([makePixelConfig()])
    mockDecryptPlatformCapiToken.mockReturnValue('decrypted-li-capi-token')
  })

  // ─── Test 1: LinkedIn action dispatches to LinkedIn trackConversion ───────────
  it('LinkedIn-platform action dispatches to LinkedIn trackConversion with correct args', async () => {
    mockActionGet.mockResolvedValue({ exists: true, data: () => makeLinkedinAction() })

    const result = await trackConversion(BASE_INPUT)

    expect(result.linkedin).toBe('sent')
    expect(result.meta).toBeUndefined()
    expect(result.google).toBeUndefined()

    // LinkedIn CAPI called once
    expect(mockLinkedinTrackConversion).toHaveBeenCalledTimes(1)
    const [callArgs] = mockLinkedinTrackConversion.mock.calls
    expect(callArgs[0].capiAccessToken).toBe('decrypted-li-capi-token')
    expect(callArgs[0].testEventCode).toBe('TEST123')
    expect(callArgs[0].input.conversionId).toBe(CONVERSION_URN)
    expect(callArgs[0].input.eventTimeMs).toBe(BASE_INPUT.eventTime.getTime())
    expect(callArgs[0].input.user.email).toBe('jane@example.com')
    expect(callArgs[0].input.user.phone).toBe('+27821234567')
    expect(callArgs[0].input.user.liFatId).toBe('AQFBFXi7_LiElMNcv8QvdA')
    expect(callArgs[0].input.value).toEqual({ amount: 299.99, currencyCode: 'USD' })
    expect(callArgs[0].input.eventId).toBe(EVENT_ID)

    // Meta CAPI NOT called
    expect(mockMetaCapiTrackConversion).not.toHaveBeenCalled()

    // decryptPlatformCapiToken called with (config, 'linkedin')
    expect(mockDecryptPlatformCapiToken).toHaveBeenCalledTimes(1)
    const [decryptArgs] = mockDecryptPlatformCapiToken.mock.calls
    expect(decryptArgs[1]).toBe('linkedin')
  })

  // ─── Test 2: Dedupe — re-firing same eventId returns prior result ─────────────
  it('re-firing same eventId returns cached dedupe result without re-dispatching', async () => {
    mockDedupeGet.mockResolvedValue({
      exists: true,
      data: () => ({ linkedin: 'sent', orgId: ORG_ID }),
    })

    const result = await trackConversion(BASE_INPUT)

    // Returns cached sent result
    expect(result.linkedin).toBe('sent')

    // Action lookup and LinkedIn CAPI should NOT be called
    expect(mockActionGet).not.toHaveBeenCalled()
    expect(mockLinkedinTrackConversion).not.toHaveBeenCalled()
    expect(mockListPixelConfigs).not.toHaveBeenCalled()
  })

  // ─── Test 3: result includes linkedin:'sent' on success ───────────────────────
  it('result includes linkedin:"sent" on successful dispatch', async () => {
    mockActionGet.mockResolvedValue({ exists: true, data: () => makeLinkedinAction() })

    const result = await trackConversion(BASE_INPUT)

    expect(result.linkedin).toBe('sent')
    expect(result.linkedinError).toBeUndefined()

    // Dedupe persisted with linkedin: 'sent'
    expect(mockDedupeSet).toHaveBeenCalledTimes(1)
    const [setData] = mockDedupeSet.mock.calls[0]
    expect(setData.linkedin).toBe('sent')
    expect(setData.platform).toBe('linkedin')
    expect(setData.orgId).toBe(ORG_ID)
  })

  // ─── Test 4: result includes linkedin:'failed' + linkedinError on provider throw ─
  it('result includes linkedin:"failed" and linkedinError when provider throws', async () => {
    mockActionGet.mockResolvedValue({ exists: true, data: () => makeLinkedinAction() })
    mockLinkedinTrackConversion.mockRejectedValue(
      new Error('LinkedIn conversionEvents POST failed: HTTP 401 — Unauthorized'),
    )

    const result = await trackConversion(BASE_INPUT)

    expect(result.linkedin).toBe('failed')
    expect(result.linkedinError).toContain('HTTP 401')

    // Dedupe still persisted after failure
    expect(mockDedupeSet).toHaveBeenCalledTimes(1)
    const [setData] = mockDedupeSet.mock.calls[0]
    expect(setData.linkedin).toBe('failed')
  })

  // ─── Test 5: throws when providerData.linkedin.conversionUrn AND partnerConversionId missing ─
  it('marks linkedin:failed when providerData.linkedin is missing conversion identifiers', async () => {
    const actionWithNoUrn = makeLinkedinAction({
      providerData: { linkedin: {} }, // neither conversionUrn nor partnerConversionId
    })
    mockActionGet.mockResolvedValue({ exists: true, data: () => actionWithNoUrn })

    const result = await trackConversion(BASE_INPUT)

    expect(result.linkedin).toBe('failed')
    expect(result.linkedinError).toContain('conversionUrn|partnerConversionId')
    // LinkedIn CAPI should not be called
    expect(mockLinkedinTrackConversion).not.toHaveBeenCalled()
  })

  // ─── Test 6: marks failed when pixel config has no capiTokenEnc ─────────────
  it('marks linkedin:failed when pixel config has no capiTokenEnc — error mentions admin token setup', async () => {
    mockActionGet.mockResolvedValue({ exists: true, data: () => makeLinkedinAction() })
    // Pixel config with linkedin slot but no capiTokenEnc
    mockListPixelConfigs.mockResolvedValue([
      makePixelConfig({ capiTokenEnc: undefined }),
    ])

    const result = await trackConversion(BASE_INPUT)

    expect(result.linkedin).toBe('failed')
    expect(result.linkedinError).toContain('capiTokenEnc')
    expect(result.linkedinError).toContain('admin')
    // LinkedIn CAPI should not be called
    expect(mockLinkedinTrackConversion).not.toHaveBeenCalled()
  })

  // ─── Test 7: uses partnerConversionId as fallback when conversionUrn absent ───
  it('uses partnerConversionId as conversionId when conversionUrn is absent', async () => {
    const actionWithPartnerConversionId = makeLinkedinAction({
      providerData: { linkedin: { partnerConversionId: '123456789' } },
    })
    mockActionGet.mockResolvedValue({ exists: true, data: () => actionWithPartnerConversionId })

    const result = await trackConversion(BASE_INPUT)

    expect(result.linkedin).toBe('sent')
    const [callArgs] = mockLinkedinTrackConversion.mock.calls
    expect(callArgs[0].input.conversionId).toBe('123456789')
  })
})
