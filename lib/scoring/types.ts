// lib/scoring/types.ts
//
// Types for the per-org lead scoring + ICP scoring system (A4).
// ScoringConfig lives at Firestore path `scoringConfig/{orgId}`.

import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { CompanySize, CompanyTier } from '@/lib/companies/types'

export interface IcpProfile {
  industries?: string[]                              // exact match against company.industry
  sizes?: CompanySize[]                              // exact match against company.size
  tiers?: CompanyTier[]                              // exact match against company.tier
  regions?: { country?: string; state?: string }[]  // matches company.address country + optional state
  minEmployeeCount?: number
  maxEmployeeCount?: number
  minAnnualRevenue?: number
  maxAnnualRevenue?: number
}

export interface LeadSignalsWeights {
  emailOpens?: number         // points per open in last 30d (default 2)
  emailClicks?: number        // points per click (default 5)
  emailReplies?: number       // points per reply (default 15)
  sequenceCompleted?: number  // points per sequence completed (default 10)
  recentContact?: number      // points if lastContactedAt within 7d (default 10)
  formSubmission?: number     // points per form submitted (default 8)
}

export interface ScoringConfig {
  orgId: string
  icp: IcpProfile
  leadWeights: LeadSignalsWeights
  aiEnabled: boolean              // master toggle for AI scoring (default false — opt-in)
  aiModel?: string                // default 'gpt-4o-mini' via AI Gateway
  aiCacheHours?: number           // default 24
  updatedBy?: string
  updatedByRef?: MemberRef
  updatedAt: Timestamp | null
  createdAt: Timestamp | null
}

export interface ScoreResult {
  score: number
  signals: Record<string, number>
}
