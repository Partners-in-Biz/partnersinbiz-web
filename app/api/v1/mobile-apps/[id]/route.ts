import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { sanitizeMobileAppInput, serializeMobileApp } from '@/lib/mobile-apps/sanitize'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadApp(id: string) {
  const doc = await adminDb.collection('mobile_apps').doc(id).get()
  if (!doc.exists) return null
  return { ref: doc.ref, app: serializeMobileApp(doc.id, doc.data()!) }
}

export const GET = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadApp(id)
  if (!loaded) return apiError('Mobile app not found', 404)
  if (user.role === 'admin' && !canAccessOrg(user, loaded.app.orgId)) return apiError('Forbidden', 403)
  return apiSuccess({ app: loaded.app })
})

export const PUT = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadApp(id)
  if (!loaded) return apiError('Mobile app not found', 404)
  if (user.role === 'admin' && !canAccessOrg(user, loaded.app.orgId)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => ({}))
  const updates = sanitizeMobileAppInput({ ...body, orgId: loaded.app.orgId })

  await loaded.ref.set({
    ...updates,
    orgId: loaded.app.orgId,
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return apiSuccess({ id, updated: true })
})

export const DELETE = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadApp(id)
  if (!loaded) return apiError('Mobile app not found', 404)
  if (user.role === 'admin' && !canAccessOrg(user, loaded.app.orgId)) return apiError('Forbidden', 403)

  await loaded.ref.set({
    status: 'deprecated',
    visibility: { ...(loaded.app.visibility ?? {}), showInClientPortal: false },
    deletedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return apiSuccess({ id, deleted: true })
})
