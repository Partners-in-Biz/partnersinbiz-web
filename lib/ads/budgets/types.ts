// lib/ads/budgets/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { AdPlatform } from '@/lib/ads/types'

export type BudgetScope = 'org' | 'platform' | 'campaign'
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly'

export interface AdBudget {
  id: string
  orgId: string
  scope: BudgetScope
  platform?: AdPlatform
  campaignId?: string
  capCents: number
  currencyCode: string
  period: BudgetPeriod
  periodStart: Timestamp
  alertThresholds: number[]  // e.g. [75, 90, 100]
  autoPause: boolean
  autoResumeOnRollover?: boolean
  name: string
  description?: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
  currentSpendCents?: number
  currentSpendPercent?: number
  lastCheckedAt?: Timestamp
  firedThresholds?: number[]
  pausedCampaignIds?: string[]
  archivedAt?: Timestamp
}

export interface AdBudgetEvent {
  id: string
  budgetId: string
  type: 'pacing_check' | 'threshold_alert' | 'exhausted' | 'auto_paused' | 'reset'
  spendCents: number
  percent: number
  threshold?: number
  pausedCampaignIds?: string[]
  occurredAt: Timestamp
}

export interface CreateBudgetInput {
  scope: BudgetScope
  platform?: AdPlatform
  campaignId?: string
  capCents: number
  currencyCode?: string  // default 'USD'
  period: BudgetPeriod
  alertThresholds?: number[]  // default [75, 90, 100]
  autoPause?: boolean
  autoResumeOnRollover?: boolean
  name: string
  description?: string
}

export interface UpdateBudgetInput {
  capCents?: number
  currencyCode?: string
  alertThresholds?: number[]
  autoPause?: boolean
  autoResumeOnRollover?: boolean
  name?: string
  description?: string
}
