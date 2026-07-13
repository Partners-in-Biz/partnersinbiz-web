import type { RuleGroup } from '@/lib/crm/segments'

export const AUDIENCE_SCHEMA_VERSION = 1 as const

export type AudienceClause =
  | { type: 'all_contacts' }
  | { type: 'segment'; segmentId: string }
  | { type: 'contacts'; contactIds: string[] }
  | { type: 'tags'; tags: string[] }
  | { type: 'rules'; ruleGroup: RuleGroup }

export interface AudienceDefinition {
  schemaVersion: typeof AUDIENCE_SCHEMA_VERSION
  name?: string
  include: AudienceClause[]
  exclude?: AudienceClause[]
  topicId: string
  holdoutPercent?: number
}

export type AudienceExclusionReason =
  | 'no_email'
  | 'invalid_email'
  | 'duplicate'
  | 'suppressed'
  | 'topic_opt_out'
  | 'frequency_cap'
  | 'sender_failure'
  | 'policy_block'
  | 'holdout'

export interface AudienceExclusion {
  contactId: string
  email?: string
  reason: AudienceExclusionReason
  detail?: string
}

export interface AudienceEstimate {
  totalCandidates: number
  eligibleCount: number
  holdoutCount: number
  eligibleContactIds: string[]
  holdoutContactIds: string[]
  excludedCounts: Partial<Record<AudienceExclusionReason, number>>
  exclusions: AudienceExclusion[]
  generatedAt: string
}

export interface AudienceVersion {
  id: string
  orgId: string
  programId: string
  version: number
  schemaVersion: typeof AUDIENCE_SCHEMA_VERSION
  definition: AudienceDefinition
  definitionHash: string
  candidateCount: number
  eligibleCount: number
  holdoutCount: number
  excludedCounts: Partial<Record<AudienceExclusionReason, number>>
  previousVersionId?: string | null
  membershipDelta?: {
    added: number
    removed: number
    unchanged: number
  }
  createdBy: string
  createdAt: unknown
}
