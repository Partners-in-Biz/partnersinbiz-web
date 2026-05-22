/**
 * GET    /api/v1/social/media/:id  — get media details
 * DELETE /api/v1/social/media/:id  — delete media
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', withTenant(async (_req, _user, orgId, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('social_media').doc(id).get()
  if (!doc.exists) return apiError('Media not found', 404)

  const data = doc.data()!
  if (data.orgId !== orgId) return apiError('Media not found', 404)

  return apiSuccess({ id: doc.id, ...data })
}))

export const DELETE = withAuth('admin', withTenant(async (req, user, orgId, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('social_media').doc(id).get()
  if (!doc.exists) return apiError('Media not found', 404)

  const data = doc.data()!
  if (data.orgId !== orgId) return apiError('Media not found', 404)
  const capabilityError = enforceAgentCapability(user, 'delete', req)
  if (capabilityError) return capabilityError

  await adminDb.collection('social_media').doc(id).delete()
  return apiSuccess({ id })
}))
