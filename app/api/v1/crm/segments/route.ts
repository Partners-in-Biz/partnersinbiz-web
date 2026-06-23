/**
 * GET  /api/v1/crm/segments  — list segments for the authenticated org
 * POST /api/v1/crm/segments  — create a new segment (admin+)
 *
 * Auth: GET → viewer+, POST → admin+
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { sanitizeSegmentFilters as sanitizeFilters, sanitizeRuleGroup } from '@/lib/crm/segments'
import type { SegmentInput } from '@/lib/crm/segments'

const ARRAY_CONTAINS_ANY_LIMIT = 10

export const GET = withCrmAuth('viewer', async (_req, ctx) => {
  const snapshot = await adminDb
    .collection('segments')
    .where('orgId', '==', ctx.orgId)
    .orderBy('createdAt', 'desc')
    .get()

  // Filter deleted in-memory (avoids composite index requirement)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segments = snapshot.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((s: any) => s.deleted !== true)

  return apiSuccess({ segments })
})

export const POST = withCrmAuth('admin', async (req, ctx) => {
  const body = (await req.json()) as Partial<SegmentInput>

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return apiError('Name is required', 400)

  const description = typeof body.description === 'string' ? body.description.trim() : ''

  const filters = sanitizeFilters(body.filters)
  if ((filters.tags?.length ?? 0) > ARRAY_CONTAINS_ANY_LIMIT) {
    return apiError(
      `tags filter supports up to ${ARRAY_CONTAINS_ANY_LIMIT} values (array-contains-any limit)`,
      400,
    )
  }

  // PR 3 pattern 1: use ctx.actor directly (no snapshotForWrite)
  const actorRef = ctx.actor

  // US-055: accept an optional generic rule tree alongside legacy filters.
  const ruleGroup = body.ruleGroup !== undefined ? sanitizeRuleGroup(body.ruleGroup) : null

  const segmentData = {
    orgId: ctx.orgId,
    name,
    description,
    filters,
    ruleGroup: ruleGroup ?? undefined,
    deleted: false,
    createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
    createdByRef: actorRef,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: actorRef,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(Object.entries(segmentData).filter(([, v]) => v !== undefined))
  const docRef = adminDb.collection('segments').doc()
  await docRef.set(sanitized)

  return apiSuccess({ id: docRef.id, ...sanitized }, 201)
})
