/**
 * PUT    /api/v1/email/:id — update draft or scheduled email
 * DELETE /api/v1/email/:id — soft-delete (sets deleted: true)
 *
 * Auth: admin or ai
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import type { ApiUser } from '@/lib/api/types'

type Params = { params: Promise<{ id: string }> }

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('emails').doc(id).get()
  if (!doc.exists) return apiError('Email not found', 404)
  const scope = resolveOrgScope(user, (doc.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const body = await req.json()
  await adminDb.collection('emails').doc(id).update({
    ...body,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id })
})

export const DELETE = withAuth('client', async (req: NextRequest, user: ApiUser, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('emails').doc(id).get()
  if (!doc.exists) return apiError('Email not found', 404)
  const scope = resolveOrgScope(user, (doc.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const capabilityError = enforceAgentCapability(user, 'delete', req)
  if (capabilityError) return capabilityError

  await adminDb.collection('emails').doc(id).update({
    deleted: true,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id })
})
