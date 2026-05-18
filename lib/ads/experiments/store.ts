// lib/ads/experiments/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type {
  AdExperiment,
  AdExperimentResult,
  CreateExperimentInput,
  UpdateExperimentInput,
  ExperimentStatus,
} from './types'
import type { AdPlatform } from '@/lib/ads/types'
import crypto from 'crypto'

const COLLECTION = 'ad_experiments'
const RESULTS = 'results'

// ── Validation ─────────────────────────────────────────────────────────────

function validateVariants(variants: CreateExperimentInput['variants']): void {
  if (variants.length < 2) {
    throw new Error('createExperiment: at least 2 variants required')
  }
  const ids = variants.map((v) => v.id)
  const uniqueIds = new Set(ids)
  if (uniqueIds.size !== ids.length) {
    throw new Error('createExperiment: variant ids must be unique')
  }
  const totalPercent = variants.reduce((sum, v) => sum + v.trafficPercent, 0)
  if (Math.round(totalPercent) !== 100) {
    throw new Error(`createExperiment: variant trafficPercent must sum to 100, got ${totalPercent}`)
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function createExperiment(args: {
  orgId: string
  createdBy: string
  input: CreateExperimentInput
}): Promise<AdExperiment> {
  validateVariants(args.input.variants)

  const id = `exp_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()

  const doc: AdExperiment = {
    id,
    orgId: args.orgId,
    name: args.input.name,
    description: args.input.description,
    level: args.input.level,
    parentEntityId: args.input.parentEntityId,
    sourceEntityId: args.input.sourceEntityId,
    platform: args.input.platform,
    variants: args.input.variants,
    successMetric: args.input.successMetric,
    status: 'draft',
    minDays: args.input.minDays ?? 7,
    significanceThreshold: args.input.significanceThreshold ?? 0.05,
    autoWinner: args.input.autoWinner ?? false,
    createdBy: args.createdBy,
    createdAt: now,
    updatedAt: now,
  }

  // Strip undefined before write
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc)) {
    if (v !== undefined) cleaned[k] = v
  }
  await adminDb.collection(COLLECTION).doc(id).set(cleaned)
  return doc
}

export async function getExperiment(id: string): Promise<AdExperiment | null> {
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  return snap.exists ? (snap.data() as AdExperiment) : null
}

export async function listExperiments(args: {
  orgId: string
  status?: ExperimentStatus
  platform?: AdPlatform
  includeArchived?: boolean
}): Promise<AdExperiment[]> {
  let q = adminDb.collection(COLLECTION).where('orgId', '==', args.orgId) as FirebaseFirestore.Query
  if (args.status) q = q.where('status', '==', args.status)
  if (args.platform) q = q.where('platform', '==', args.platform)
  const snap = await q.get()
  let docs = snap.docs.map((d) => d.data() as AdExperiment)
  if (!args.includeArchived) {
    docs = docs.filter((e) => !e.archivedAt)
  }
  return docs.sort((a, b) => (b.updatedAt as Timestamp).seconds - (a.updatedAt as Timestamp).seconds)
}

export async function updateExperiment(id: string, patch: UpdateExperimentInput): Promise<void> {
  // If variants are being updated, we must check status=draft
  if (patch.variants !== undefined) {
    const existing = await getExperiment(id)
    if (!existing) throw new Error(`updateExperiment: experiment ${id} not found`)
    if (existing.status !== 'draft') {
      throw new Error('updateExperiment: variants can only be changed when status=draft')
    }
    validateVariants(patch.variants)
  }

  const clean: Record<string, unknown> = { updatedAt: Timestamp.now() }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v
  }
  await adminDb.collection(COLLECTION).doc(id).update(clean)
}

export async function archiveExperiment(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).update({
    archivedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

export async function updateExperimentStatus(
  id: string,
  status: ExperimentStatus,
  extras?: {
    startedAt?: Timestamp
    endedAt?: Timestamp
    declaredWinnerVariantId?: string
    significance?: AdExperiment['significance']
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    status,
    updatedAt: Timestamp.now(),
  }
  if (extras?.startedAt !== undefined) patch.startedAt = extras.startedAt
  if (extras?.endedAt !== undefined) patch.endedAt = extras.endedAt
  if (extras?.declaredWinnerVariantId !== undefined) patch.declaredWinnerVariantId = extras.declaredWinnerVariantId
  if (extras?.significance !== undefined) patch.significance = extras.significance
  await adminDb.collection(COLLECTION).doc(id).update(patch)
}

// ── Results subcollection ──────────────────────────────────────────────────

export async function appendResult(args: {
  experimentId: string
  result: AdExperimentResult
}): Promise<void> {
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args.result)) {
    if (v !== undefined) cleaned[k] = v
  }
  await adminDb
    .collection(COLLECTION)
    .doc(args.experimentId)
    .collection(RESULTS)
    .doc(args.result.id)
    .set(cleaned)
}

export async function listResults(args: {
  experimentId: string
  variantId?: string
}): Promise<AdExperimentResult[]> {
  let q = adminDb
    .collection(COLLECTION)
    .doc(args.experimentId)
    .collection(RESULTS)
    .where('experimentId', '==', args.experimentId) as FirebaseFirestore.Query
  if (args.variantId) q = q.where('variantId', '==', args.variantId)
  const snap = await q.get()
  return snap.docs.map((d) => d.data() as AdExperimentResult)
}
