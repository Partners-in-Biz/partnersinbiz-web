/**
 * GET  /api/v1/crm/pipelines?archived=true|false
 *   → viewer+  Returns all pipelines for org. Default: archived=false.
 *
 * POST /api/v1/crm/pipelines
 *   → admin+  Creates a new pipeline.
 */
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  assertStagesValid,
  sanitizePipelineForWrite,
  clearOtherDefaults,
} from '@/lib/pipelines/store'
import { PipelineValidationError } from '@/lib/pipelines/types'
import type { Pipeline } from '@/lib/pipelines/types'

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number }
    if (typeof candidate.toMillis === 'function') return candidate.toMillis()
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000
  }
  return 0
}

// ── GET ───────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const archivedParam = searchParams.get('archived')
  const showArchived = archivedParam === 'true'

  const snap = await adminDb
    .collection('pipelines')
    .where('orgId', '==', ctx.orgId)
    .get()

  const pipelines: Pipeline[] = snap.docs.map((doc) => ({
    ...(doc.data() as Pipeline),
    id: doc.id,
  }))
    .filter((pipeline) => pipeline.orgId === ctx.orgId && pipeline.deleted !== true)
    .filter((pipeline) => showArchived || pipeline.archived !== true)
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      return timestampMillis(b.createdAt) - timestampMillis(a.createdAt)
    })

  return apiSuccess({ pipelines })
})

// ── POST ──────────────────────────────────────────────────────────────────────

export const POST = withCrmAuth('admin', async (req, ctx) => {
  let body: Partial<Pipeline>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (!body || Object.keys(body).length === 0) return apiError('Empty body', 400)

  // Required: name
  if (!body.name?.trim()) return apiError('name is required', 400)
  if (body.name.trim().length > 100) return apiError('name must be 100 characters or fewer', 400)

  // Required: stages
  if (!Array.isArray(body.stages)) return apiError('stages is required and must be an array', 400)

  // Validate stages
  try {
    assertStagesValid(body.stages)
  } catch (err) {
    if (err instanceof PipelineValidationError) {
      return apiError('Stage validation failed', 400, { details: err.details })
    }
    throw err
  }

  // Duplicate name check within org
  const dupSnap = await adminDb
    .collection('pipelines')
    .where('orgId', '==', ctx.orgId)
    .where('name', '==', body.name.trim())
    .limit(1)
    .get()

  const hasActiveDuplicate = dupSnap.docs.some((doc) => {
    const pipeline = doc.data() as Partial<Pipeline>
    return pipeline.orgId === ctx.orgId && pipeline.deleted !== true
  })

  if (hasActiveDuplicate) {
    return apiError(`A pipeline named "${body.name.trim()}" already exists in this workspace`, 400)
  }

  // Strip NEVER_FROM_BODY fields
  const sanitized = sanitizePipelineForWrite(body)

  const now = Timestamp.now()
  const isDefault = (body.isDefault ?? false) === true

  const pipelineData: Record<string, unknown> = {
    orgId: ctx.orgId,
    ...sanitized,
    name: body.name.trim(),
    isDefault,
    archived: false,
    deleted: false,
    createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
    createdByRef: ctx.actor,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: ctx.actor,
    createdAt: now,
    updatedAt: now,
  }

  // Strip undefined
  const toWrite = Object.fromEntries(
    Object.entries(pipelineData).filter(([, v]) => v !== undefined),
  )

  const ref = adminDb.collection('pipelines').doc()
  await ref.set(toWrite)

  // If isDefault, atomically clear other defaults (best-effort)
  if (isDefault) {
    try {
      await clearOtherDefaults(ctx.orgId, ref.id)
    } catch {
      // non-fatal — do not fail the response
    }
  }

  const pipeline = { ...(toWrite as unknown as Pipeline), id: ref.id }
  return apiSuccess({ pipeline }, 201)
})
