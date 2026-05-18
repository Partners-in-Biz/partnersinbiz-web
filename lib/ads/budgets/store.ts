// lib/ads/budgets/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import type { AdBudget, AdBudgetEvent, CreateBudgetInput, UpdateBudgetInput, BudgetScope, BudgetPeriod } from './types'
import type { AdPlatform } from '@/lib/ads/types'
import crypto from 'crypto'

const COLLECTION = 'ad_budgets'
const EVENTS = 'events'

export function computeWindowStart(period: BudgetPeriod, now: Date = new Date()): Timestamp {
  const utcYear = now.getUTCFullYear()
  const utcMonth = now.getUTCMonth()
  const utcDate = now.getUTCDate()
  const utcDay = now.getUTCDay()  // 0=Sun..6=Sat

  if (period === 'daily') {
    return Timestamp.fromDate(new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0)))
  }
  if (period === 'weekly') {
    // Monday-start week. Compute days since Monday: (utcDay + 6) % 7.
    const daysSinceMonday = (utcDay + 6) % 7
    const monday = new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0))
    monday.setUTCDate(monday.getUTCDate() - daysSinceMonday)
    return Timestamp.fromDate(monday)
  }
  // monthly
  return Timestamp.fromDate(new Date(Date.UTC(utcYear, utcMonth, 1, 0, 0, 0, 0)))
}

export async function createBudget(args: { orgId: string; createdBy: string; input: CreateBudgetInput }): Promise<AdBudget> {
  const id = `bgt_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()

  // Validate scope-required fields
  if (args.input.scope === 'platform' && !args.input.platform) {
    throw new Error('createBudget: platform scope requires platform field')
  }
  if (args.input.scope === 'campaign' && (!args.input.platform || !args.input.campaignId)) {
    throw new Error('createBudget: campaign scope requires platform + campaignId fields')
  }
  if (!Number.isFinite(args.input.capCents) || args.input.capCents <= 0) {
    throw new Error('createBudget: capCents must be a positive integer')
  }

  const doc: AdBudget = {
    id, orgId: args.orgId,
    scope: args.input.scope,
    platform: args.input.platform,
    campaignId: args.input.campaignId,
    capCents: Math.round(args.input.capCents),
    currencyCode: args.input.currencyCode ?? 'USD',
    period: args.input.period,
    periodStart: computeWindowStart(args.input.period),
    alertThresholds: args.input.alertThresholds ?? [75, 90, 100],
    autoPause: args.input.autoPause ?? false,
    autoResumeOnRollover: args.input.autoResumeOnRollover ?? false,
    name: args.input.name,
    description: args.input.description,
    createdBy: args.createdBy,
    createdAt: now,
    updatedAt: now,
    firedThresholds: [],
  }
  // Strip undefined before write
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc)) {
    if (v !== undefined) cleaned[k] = v
  }
  await adminDb.collection(COLLECTION).doc(id).set(cleaned)
  return doc
}

export async function getBudget(id: string): Promise<AdBudget | null> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  return snap.exists ? (snap.data() as AdBudget) : null
}

export async function listBudgets(args: {
  orgId: string
  scope?: BudgetScope
  platform?: AdPlatform
  campaignId?: string
  includeArchived?: boolean
}): Promise<AdBudget[]> {
  let q = adminDb.collection(COLLECTION).where('orgId', '==', args.orgId) as FirebaseFirestore.Query
  if (args.scope) q = q.where('scope', '==', args.scope)
  if (args.platform) q = q.where('platform', '==', args.platform)
  if (args.campaignId) q = q.where('campaignId', '==', args.campaignId)
  const snap = await q.get()
  let docs = snap.docs.map((d) => d.data() as AdBudget)
  if (!args.includeArchived) {
    docs = docs.filter((b) => !b.archivedAt)
  }
  return docs.sort((a, b) => (b.updatedAt as Timestamp).seconds - (a.updatedAt as Timestamp).seconds)
}

export async function updateBudget(id: string, patch: UpdateBudgetInput): Promise<void> {
  const clean: Record<string, unknown> = { updatedAt: Timestamp.now() }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v
  }
  if (typeof patch.capCents === 'number') {
    if (!Number.isFinite(patch.capCents) || patch.capCents <= 0) {
      throw new Error('updateBudget: capCents must be a positive integer')
    }
    clean.capCents = Math.round(patch.capCents)
  }
  await adminDb.collection(COLLECTION).doc(id).update(clean)
}

export async function updateBudgetTracking(id: string, tracking: {
  currentSpendCents: number
  currentSpendPercent: number
  lastCheckedAt: Timestamp
  firedThresholds?: number[]
  pausedCampaignIds?: string[]
}): Promise<void> {
  const patch: Record<string, unknown> = {
    currentSpendCents: tracking.currentSpendCents,
    currentSpendPercent: tracking.currentSpendPercent,
    lastCheckedAt: tracking.lastCheckedAt,
    updatedAt: Timestamp.now(),
  }
  if (tracking.firedThresholds !== undefined) patch.firedThresholds = tracking.firedThresholds
  if (tracking.pausedCampaignIds !== undefined) patch.pausedCampaignIds = tracking.pausedCampaignIds
  await adminDb.collection(COLLECTION).doc(id).update(patch)
}

export async function archiveBudget(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).update({
    archivedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

export async function appendEvent(args: {
  budgetId: string
  type: AdBudgetEvent['type']
  spendCents: number
  percent: number
  threshold?: number
  pausedCampaignIds?: string[]
}): Promise<AdBudgetEvent> {
  const id = `evt_${crypto.randomBytes(6).toString('hex')}`
  const occurredAt = Timestamp.now()
  const doc: AdBudgetEvent = {
    id, budgetId: args.budgetId, type: args.type,
    spendCents: args.spendCents, percent: args.percent,
    threshold: args.threshold, pausedCampaignIds: args.pausedCampaignIds,
    occurredAt,
  }
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc)) if (v !== undefined) cleaned[k] = v
  await adminDb.collection(COLLECTION).doc(args.budgetId).collection(EVENTS).doc(id).set(cleaned)
  return doc
}

export async function listEvents(args: { budgetId: string; limit?: number }): Promise<AdBudgetEvent[]> {
  const snap = await adminDb.collection(COLLECTION).doc(args.budgetId)
    .collection(EVENTS).orderBy('occurredAt', 'desc').limit(args.limit ?? 50).get()
  return snap.docs.map((d) => d.data() as AdBudgetEvent)
}

export async function resetBudgetForNewPeriod(args: {
  budgetId: string
  newPeriodStart: Timestamp
}): Promise<void> {
  await adminDb.collection(COLLECTION).doc(args.budgetId).update({
    periodStart: args.newPeriodStart,
    firedThresholds: [],
    pausedCampaignIds: FieldValue.delete(),
    currentSpendCents: 0,
    currentSpendPercent: 0,
    updatedAt: Timestamp.now(),
  })
}
