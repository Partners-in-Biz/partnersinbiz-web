// lib/crm/facts/types.ts
// ContactFact evidence ledger types (Comp AI pattern, multi-tenant PiB).

import type { MemberRef } from '@/lib/orgMembers/memberRef'

export type FactBand = 'VERIFIED' | 'PROBABLE' | 'POSSIBLE'
export type FactStatus = 'APPLIED' | 'PROPOSED' | 'DISMISSED' | 'SUPERSEDED'

export type EvidenceKind =
  | 'profile.email-match'
  | 'linkedin.employer-and-name'
  | 'crm.thread-reply'
  | 'crm.signature-block'
  | 'github.account-identity'
  | 'crm.meeting-attendance'
  | 'web.cited-claim'
  | 'handle.name-form'
  | 'search.cites-profile'
  | 'employer-only'
  | 'contradiction'

export type FactField =
  | 'name'
  | 'title'
  | 'department'
  | 'phone'
  | 'linkedinUrl'
  | 'website'
  | 'twitterUrl'
  | 'githubUrl'
  | 'employer'
  | 'seniority'
  | 'function'
  | 'location'
  | 'tenure'

export interface Evidence {
  kind: EvidenceKind
  /** What was actually seen, in a rep's words. */
  detail: string
  sourceUrl?: string
}

export interface ScoredEvidence {
  score: number
  band: FactBand | null
  hasPrimary: boolean
  rationale: string
}

export interface ContactFact {
  id: string
  orgId: string
  contactId: string
  field: FactField
  value: string
  score: number
  band: FactBand
  status: FactStatus
  evidence: Evidence[]
  method: string
  sourceUrl?: string | null
  sessionId?: string | null
  agentId?: string | null
  rationale: string
  observedAt: unknown
  supersededAt?: unknown
  decidedAt?: unknown
  decidedByRef?: MemberRef | null
  createdAt: unknown
  updatedAt: unknown
  createdByRef?: MemberRef | null
  deleted?: boolean
}

export interface ContactFactSnapshot {
  id: string
  field: FactField
  value: string
  status: FactStatus
  band?: FactBand
}

/** Minimal contact shape for fact write rules. */
export interface FactContactView {
  id: string
  orgId: string
  name?: string | null
  email?: string | null
  jobTitle?: string | null
  department?: string | null
  phone?: string | null
  website?: string | null
  linkedinUrl?: string | null
  twitterUrl?: string | null
  githubUrl?: string | null
  company?: string | null
  /** Fields a human typed — never agent-overwritten. */
  humanOwnedFields?: string[] | null
  [key: string]: unknown
}

export interface RecordFactInput {
  orgId: string
  contactId: string
  field: FactField
  value: string
  evidence: Evidence[]
  method: string
  sourceUrl?: string
  sessionId?: string
  agentId?: string
  createdByRef?: MemberRef | null
}

export interface RecordFactResult {
  stored: boolean
  applied: boolean
  band: FactBand | null
  score: number
  rationale: string
  factId?: string
  reason?: string
}

export type FactDecision = 'accept' | 'dismiss'

export interface DecideFactInput {
  orgId: string
  contactId: string
  factId: string
  decision: FactDecision
  decidedByRef?: MemberRef | null
}

export interface DecideFactResult {
  ok: boolean
  applied: boolean
  status?: FactStatus
  reason?: string
}
