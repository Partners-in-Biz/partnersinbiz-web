// __tests__/api/v1/crm/scoring/_fixtures.ts
import type { ScoringConfig, IcpProfile, LeadSignalsWeights } from '@/lib/scoring/types'
import { Timestamp } from 'firebase-admin/firestore'

export { uidFor, buildAdminMember, buildRegularMember, buildOwnerMember, buildViewerMember } from '../companies/_fixtures'

export const defaultLeadWeights: LeadSignalsWeights = {
  emailOpens: 2,
  emailClicks: 5,
  emailReplies: 15,
  sequenceCompleted: 10,
  recentContact: 10,
  formSubmission: 8,
}

export function buildConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return {
    orgId: 'org-a',
    icp: {},
    leadWeights: defaultLeadWeights,
    aiEnabled: false,
    aiModel: 'gpt-4o-mini',
    aiCacheHours: 24,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  }
}

export const sampleSaaSIcp: IcpProfile = {
  industries: ['Software', 'SaaS'],
  sizes: ['51-200', '201-1000'],
  tiers: ['mid-market', 'enterprise'],
  regions: [{ country: 'USA' }, { country: 'GBR' }],
  minEmployeeCount: 50,
}
