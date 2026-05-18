// lib/pipelines/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { Pipeline, PipelineInput, PipelineStage } from './types'
import { PipelineValidationError } from './types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const PIPELINES = 'pipelines'

const STAGE_ID_REGEX = /^[a-z0-9_-]{1,40}$/

export interface LoadedPipeline {
  ref: FirebaseFirestore.DocumentReference
  data: Pipeline
}

// Fields that must never come from the request body — the route handler
// (via middleware-authoritative ctx) controls these. Stripping them here
// blocks the cross-tenant-via-body-orgId attack at the source.
const NEVER_FROM_BODY = new Set([
  'id', 'orgId',
  'createdBy', 'createdByRef', 'createdAt',
  'updatedBy', 'updatedByRef', 'updatedAt',
  'deleted',
])

const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'discovery',    label: 'Discovery',    kind: 'open', order: 0, probability: 10 },
  { id: 'proposal',     label: 'Proposal',     kind: 'open', order: 1, probability: 30 },
  { id: 'negotiation',  label: 'Negotiation',  kind: 'open', order: 2, probability: 70 },
  { id: 'won',          label: 'Won',          kind: 'won',  order: 3, probability: 100 },
  { id: 'lost',         label: 'Lost',         kind: 'lost', order: 4, probability: 0 },
]

export async function loadPipeline(id: string, orgId: string): Promise<LoadedPipeline | null> {
  if (!id || !orgId) return null
  const ref = adminDb.collection(PIPELINES).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return null
  const data = snap.data() as Pipeline
  if (data.orgId !== orgId) return null
  if (data.deleted === true) return null
  return { ref, data: { ...data, id: ref.id } }
}

export async function getDefaultPipelineForOrg(orgId: string): Promise<Pipeline | null> {
  const snap = await adminDb.collection(PIPELINES)
    .where('orgId', '==', orgId)
    .where('isDefault', '==', true)
    .where('deleted', '==', false)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { ...(doc.data() as Pipeline), id: doc.id }
}

export async function bootstrapDefaultPipeline(orgId: string, actor: MemberRef): Promise<Pipeline> {
  // Check if any non-deleted pipeline exists for this org
  const existing = await adminDb.collection(PIPELINES)
    .where('orgId', '==', orgId)
    .where('deleted', '!=', true)
    .orderBy('deleted')
    .limit(20)
    .get()

  if (!existing.empty) {
    // Find existing default, or mark first as default
    const defaultDoc = existing.docs.find(d => (d.data() as Pipeline).isDefault)
    if (defaultDoc) {
      return { ...(defaultDoc.data() as Pipeline), id: defaultDoc.id }
    }
    // No default — mark the first one as default
    const first = existing.docs[0]
    await first.ref.update({ isDefault: true, updatedAt: Timestamp.now() })
    return { ...(first.data() as Pipeline), id: first.id, isDefault: true }
  }

  // Create a new default pipeline
  const now = Timestamp.now()
  const newPipeline: Omit<Pipeline, 'id'> = {
    orgId,
    name: 'Default Pipeline',
    stages: DEFAULT_STAGES,
    isDefault: true,
    archived: false,
    createdBy: actor.uid,
    createdByRef: actor,
    updatedBy: actor.uid,
    updatedByRef: actor,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }

  const ref = await adminDb.collection(PIPELINES).add(newPipeline)
  return { ...newPipeline, id: ref.id }
}

export async function clearOtherDefaults(orgId: string, exceptId: string): Promise<void> {
  const snap = await adminDb.collection(PIPELINES)
    .where('orgId', '==', orgId)
    .where('isDefault', '==', true)
    .get()

  if (snap.empty) return

  const toUpdate = snap.docs.filter(d => d.id !== exceptId)
  if (toUpdate.length === 0) return

  for (let i = 0; i < toUpdate.length; i += 30) {
    const chunk = toUpdate.slice(i, i + 30)
    const batch = adminDb.batch()
    for (const doc of chunk) {
      batch.update(doc.ref, { isDefault: false, updatedAt: Timestamp.now() })
    }
    await batch.commit()
  }
}

export function sanitizePipelineForWrite(input: Partial<PipelineInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue
    if (NEVER_FROM_BODY.has(k)) continue
    out[k] = v
  }
  return out
}

export function assertStagesValid(stages: PipelineStage[]): void {
  const errors: { field: string; message: string }[] = []

  if (!Array.isArray(stages) || stages.length < 3) {
    errors.push({ field: 'stages', message: 'Pipeline must have at least 3 stages' })
  }

  if (errors.length > 0) throw new PipelineValidationError(errors)

  const ids = stages.map(s => s.id)
  const uniqueIds = new Set(ids)
  if (uniqueIds.size !== ids.length) {
    errors.push({ field: 'stages', message: 'Stage IDs must be unique' })
  }

  for (const stage of stages) {
    if (!STAGE_ID_REGEX.test(stage.id)) {
      errors.push({ field: `stages[${stage.id}].id`, message: `Stage id "${stage.id}" does not match ^[a-z0-9_-]{1,40}$` })
    }
    if (typeof stage.probability !== 'number' || stage.probability < 0 || stage.probability > 100) {
      errors.push({ field: `stages[${stage.id}].probability`, message: 'Probability must be an integer between 0 and 100' })
    }
    if (typeof stage.order !== 'number') {
      errors.push({ field: `stages[${stage.id}].order`, message: 'Order must be numeric' })
    }
  }

  const wonCount = stages.filter(s => s.kind === 'won').length
  if (wonCount !== 1) {
    errors.push({ field: 'stages', message: `Pipeline must have exactly 1 "won" stage, found ${wonCount}` })
  }

  const lostCount = stages.filter(s => s.kind === 'lost').length
  if (lostCount !== 1) {
    errors.push({ field: 'stages', message: `Pipeline must have exactly 1 "lost" stage, found ${lostCount}` })
  }

  if (errors.length > 0) throw new PipelineValidationError(errors)
}
