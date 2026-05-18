// lib/ads/experiments/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { AdPlatform } from '@/lib/ads/types'

export type ExperimentLevel = 'adset' | 'ad'
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'winner_declared'
export type ExperimentMetric = 'cpc' | 'cpa' | 'conv_rate' | 'ctr' | 'roas'

export interface AdExperimentVariant {
  id: string  // 'a'|'b'|'c'|'d'
  name: string
  trafficPercent: number
  entityId?: string
  overrides?: Record<string, unknown>
}

export interface AdExperiment {
  id: string
  orgId: string
  name: string
  description?: string
  level: ExperimentLevel
  parentEntityId: string  // campaignId (for adset) or adSetId (for ad)
  /** Source canonical entity to duplicate per variant. */
  sourceEntityId: string
  platform: AdPlatform
  variants: AdExperimentVariant[]
  successMetric: ExperimentMetric
  status: ExperimentStatus
  minDays: number
  significanceThreshold: number  // default 0.05
  autoWinner: boolean
  startedAt?: Timestamp
  endedAt?: Timestamp
  declaredWinnerVariantId?: string
  significance?: {
    pValue: number
    confident: boolean
    winnerVariantId?: string
    computedAt: Timestamp
  }
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
  archivedAt?: Timestamp
}

export interface AdExperimentResult {
  id: string
  experimentId: string
  variantId: string
  fromDate: string
  toDate: string
  impressions: number
  clicks: number
  conversions: number
  spendCents: number
  ctr: number
  cpc?: number
  cpa?: number
  convRate: number
  computedAt: Timestamp
}

export interface CreateExperimentInput {
  name: string
  description?: string
  level: ExperimentLevel
  parentEntityId: string
  sourceEntityId: string
  platform: AdPlatform
  variants: AdExperimentVariant[]
  successMetric: ExperimentMetric
  minDays?: number  // default 7
  significanceThreshold?: number  // default 0.05
  autoWinner?: boolean  // default false
}

export interface UpdateExperimentInput {
  name?: string
  description?: string
  variants?: AdExperimentVariant[]  // only allowed when status=draft
  successMetric?: ExperimentMetric
  minDays?: number
  significanceThreshold?: number
  autoWinner?: boolean
}
