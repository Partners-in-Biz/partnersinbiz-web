jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import { DEFAULT_FEATURE_FLAGS, resolveFeatureFlags } from '@/app/api/v1/org/feature-flags/route'

describe('organisation feature flags', () => {
  it('keeps Marketing Studio V2 safely off until an organisation opts in', () => {
    expect(DEFAULT_FEATURE_FLAGS.emailMarketingStudioV2).toBe(false)
    expect(resolveFeatureFlags(undefined).emailMarketingStudioV2).toBe(false)
    expect(resolveFeatureFlags({ emailMarketingStudioV2: true }).emailMarketingStudioV2).toBe(true)
    expect(resolveFeatureFlags({ emailMarketingStudioV2: 'true' }).emailMarketingStudioV2).toBe(true)
  })

  it('keeps organisation teams off until an organisation opts in', () => {
    expect(DEFAULT_FEATURE_FLAGS.orgTeamsEnabled).toBe(false)
    expect(resolveFeatureFlags(undefined).orgTeamsEnabled).toBe(false)
    expect(resolveFeatureFlags({}).orgTeamsEnabled).toBe(false)
    expect(resolveFeatureFlags({ orgTeamsEnabled: true }).orgTeamsEnabled).toBe(true)
    expect(resolveFeatureFlags({ orgTeamsEnabled: 'true' }).orgTeamsEnabled).toBe(true)
  })

  it('keeps agent rooms off until an organisation opts in', async () => {
    expect(DEFAULT_FEATURE_FLAGS.agentRoomsEnabled).toBe(false)
    expect(resolveFeatureFlags(undefined).agentRoomsEnabled).toBe(false)
    expect(resolveFeatureFlags({}).agentRoomsEnabled).toBe(false)
    expect(resolveFeatureFlags({ agentRoomsEnabled: true }).agentRoomsEnabled).toBe(true)
    expect(resolveFeatureFlags({ agentRoomsEnabled: 'true' }).agentRoomsEnabled).toBe(true)
  })

  it('keeps personal agent rooms off until an organisation opts in', () => {
    expect(DEFAULT_FEATURE_FLAGS.personalAgentRoomsEnabled).toBe(false)
    expect(resolveFeatureFlags(undefined).personalAgentRoomsEnabled).toBe(false)
    expect(resolveFeatureFlags({}).personalAgentRoomsEnabled).toBe(false)
    expect(resolveFeatureFlags({ personalAgentRoomsEnabled: true }).personalAgentRoomsEnabled).toBe(true)
  })

  it('keeps bot routines off until an organisation opts in', () => {
    expect(DEFAULT_FEATURE_FLAGS.botRoutinesEnabled).toBe(false)
    expect(resolveFeatureFlags(undefined).botRoutinesEnabled).toBe(false)
    expect(resolveFeatureFlags({}).botRoutinesEnabled).toBe(false)
    expect(resolveFeatureFlags({ botRoutinesEnabled: true }).botRoutinesEnabled).toBe(true)
    expect(resolveFeatureFlags({ botRoutinesEnabled: 'true' }).botRoutinesEnabled).toBe(true)
  })
})
