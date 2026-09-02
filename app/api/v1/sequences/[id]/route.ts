// app/api/v1/sequences/[id]/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import type { SequenceInput } from '@/lib/sequences/types'
import { mergeSequenceForActivationValidation, validateSequenceActivation } from '@/lib/sequences/validation'
import { assertEmailMarketingAgentActionWithTask } from '@/lib/email-marketing/agent-governance'
import { persistSequenceUpdateWithVersion } from '@/lib/sequences/workflow-version-store'
import { sanitizeSequenceQuietHours } from '@/lib/sequences/quiet-hours'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('sequences').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  return apiSuccess({ id: snap.id, ...snap.data() })
})

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('sequences').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const body = await req.json().catch(() => ({}))
  if (body.status === 'active' || body.steps !== undefined) {
    const activationError = validateSequenceActivation(
      mergeSequenceForActivationValidation(snap.data() as SequenceInput, body as Partial<SequenceInput>),
    )
    if (activationError) return apiError(activationError, 400)
  }
  if (body.status === 'active' && snap.data()?.status !== 'active') {
    try {
      await assertEmailMarketingAgentActionWithTask(user, 'email_marketing_send', snap.data()?.approvalState, {
        orgId: scope.orgId, resourceType: 'email_sequence', resourceId: id,
      }, snap.data() as Record<string, unknown>)
    } catch (error) {
      return apiError(error instanceof Error ? error.message : 'Sequence activation is not authorised', 403)
    }
  }
  const update: Partial<SequenceInput> & Record<string, unknown> = {}
  if ('clientVisibility' in body) Object.assign(update, clientVisibilityFieldsForWrite(body.clientVisibility))
  if (typeof body.name === 'string') update.name = body.name.trim()
  if (typeof body.description === 'string') update.description = body.description
  if (body.status === 'draft' || body.status === 'active' || body.status === 'paused' || body.status === 'archived') update.status = body.status
  if (Array.isArray(body.steps)) update.steps = body.steps
  if (typeof body.topicId === 'string') update.topicId = body.topicId.trim()
  if (Array.isArray(body.goals)) update.goals = body.goals
  if (body.reentryPolicy && typeof body.reentryPolicy === 'object') update.reentryPolicy = body.reentryPolicy
  if (typeof body.maxActiveEnrollments === 'number') update.maxActiveEnrollments = Math.max(0, Math.floor(body.maxActiveEnrollments))
  if (body.quietHours && typeof body.quietHours === 'object') {
    try {
      update.quietHours = sanitizeSequenceQuietHours(body.quietHours)
    } catch (error) {
      return apiError(error instanceof Error ? error.message : 'Invalid quiet hours', 400)
    }
  }
  if (snap.data()?.approvalState?.status === 'approved' && (body.steps !== undefined || body.topicId !== undefined || body.goals !== undefined || body.quietHours !== undefined)) {
    update.approvalState = {
      status: 'revoked', approvedBy: null, approvedByType: null, approvedAt: null, approvalTaskId: null,
    }
  }
  const persistedUpdate = await persistSequenceUpdateWithVersion({
    sequenceId: id,
    existing: { ...(snap.data() as SequenceInput), id } as import('@/lib/sequences/types').Sequence,
    patch: { ...update, updatedAt: FieldValue.serverTimestamp() },
  })
  return apiSuccess({ id, ...persistedUpdate })
})

export const DELETE = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('sequences').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  await adminDb.collection('sequences').doc(id).update({ deleted: true, updatedAt: FieldValue.serverTimestamp() })
  return apiSuccess({ id })
})
