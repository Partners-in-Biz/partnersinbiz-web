import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { sanitizeMobileAppInput, serializeMobileApp } from '@/lib/mobile-apps/sanitize'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim()
  if (!orgId) return apiError('orgId is required', 400)
  if (user.role === 'admin' && !canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const snap = await adminDb
    .collection('mobile_apps')
    .where('orgId', '==', orgId)
    .get()

  const apps = snap.docs
    .map((doc) => serializeMobileApp(doc.id, doc.data()))
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))

  return apiSuccess({ apps })
})

export const POST = withAuth('admin', async (req, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  if (!orgId) return apiError('orgId is required', 400)
  if (user.role === 'admin' && !canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)

  const data = sanitizeMobileAppInput({ ...body, orgId })
  if (!data.name || data.name === 'Untitled app') return apiError('name is required', 400)

  const ref = await adminDb.collection('mobile_apps').add({
    ...data,
    orgId,
    createdBy: user.uid,
    createdByType: user.role === 'ai' ? 'agent' : 'user',
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id: ref.id }, 201)
})
