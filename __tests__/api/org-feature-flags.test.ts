jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import { DEFAULT_FEATURE_FLAGS, resolveFeatureFlags } from '@/app/api/v1/org/feature-flags/route'

describe('organisation feature flags', () => {
  it('keeps Marketing Studio V2 safely off until an organisation opts in', () => {
    expect(DEFAULT_FEATURE_FLAGS.emailMarketingStudioV2).toBe(false)
    expect(resolveFeatureFlags(undefined).emailMarketingStudioV2).toBe(false)
    expect(resolveFeatureFlags({ emailMarketingStudioV2: true }).emailMarketingStudioV2).toBe(true)
    expect(resolveFeatureFlags({ emailMarketingStudioV2: 'true' }).emailMarketingStudioV2).toBe(true)
  })
})
