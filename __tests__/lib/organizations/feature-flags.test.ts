const getOrgDoc = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name !== 'organizations') throw new Error(`Unexpected collection ${name}`)
      return {
        doc: (id: string) => ({
          get: () => getOrgDoc(id),
        }),
      }
    }),
  },
}))

import { featureFlagsFromOrgData, orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import { DEFAULT_FEATURE_FLAGS } from '@/app/api/v1/org/feature-flags/route'

describe('orgFeatureFlagEnabled', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns false when the organisation is missing', async () => {
    getOrgDoc.mockResolvedValueOnce({ exists: false })

    await expect(orgFeatureFlagEnabled('missing-org', 'orgTeamsEnabled')).resolves.toBe(false)
  })

  it('returns true when the flag is true in settings.featureFlags', async () => {
    getOrgDoc.mockResolvedValueOnce({
      exists: true,
      data: () => ({ settings: { featureFlags: { orgTeamsEnabled: true } } }),
    })

    await expect(orgFeatureFlagEnabled('org_1', 'orgTeamsEnabled')).resolves.toBe(true)
    expect(getOrgDoc).toHaveBeenCalledWith('org_1')
  })

  it('defaults orgTeamsEnabled to false when the key is missing', async () => {
    getOrgDoc.mockResolvedValueOnce({
      exists: true,
      data: () => ({ settings: { featureFlags: { show_ai_features: true } } }),
    })

    await expect(orgFeatureFlagEnabled('org_1', 'orgTeamsEnabled')).resolves.toBe(false)
  })
})

describe('featureFlagsFromOrgData', () => {
  it('defaults orgTeamsEnabled to false when settings or flags are missing', () => {
    expect(DEFAULT_FEATURE_FLAGS.orgTeamsEnabled).toBe(false)
    expect(featureFlagsFromOrgData(undefined).orgTeamsEnabled).toBe(false)
    expect(featureFlagsFromOrgData({}).orgTeamsEnabled).toBe(false)
    expect(featureFlagsFromOrgData({ settings: {} }).orgTeamsEnabled).toBe(false)
  })

  it('reads orgTeamsEnabled from settings.featureFlags', () => {
    expect(
      featureFlagsFromOrgData({ settings: { featureFlags: { orgTeamsEnabled: true } } }).orgTeamsEnabled,
    ).toBe(true)
  })
})
