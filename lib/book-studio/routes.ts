import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { actorFields, collectionFor, ensureBookStudioAccess, validateBookStudioReferences } from './api'
import { sanitizeBookStudioRecordInput, serializeBookStudioRecord } from './sanitize'
import type { BookStudioResourceKey } from './types'

export function createBookStudioResourceHandlers(resource: BookStudioResourceKey) {
  const collectionName = collectionFor(resource)

  const GET = withAuth('admin', async (req, user) => {
    const access = await ensureBookStudioAccess(req, user)
    if (access.error) return access.error

    const snap = await adminDb.collection(collectionName).where('orgId', '==', access.orgId).get()
    const records = snap.docs
      .map((doc) => serializeBookStudioRecord(doc.id, doc.data()))
      .filter((record) => record.deleted !== true)

    return apiSuccess({ resource, records })
  })

  const POST = withAuth('admin', async (req, user) => {
    let body: Record<string, unknown>
    try {
      body = await req.json() as Record<string, unknown>
    } catch {
      const access = await ensureBookStudioAccess(req, user, undefined, 'write')
      if (access.error) return access.error
      return Response.json({ success: false, error: 'Malformed JSON body' }, { status: 400 })
    }
    const access = await ensureBookStudioAccess(req, user, body, 'write')
    if (access.error) return access.error

    const data = sanitizeBookStudioRecordInput(resource, body, access.orgId)
    const referenceError = await validateBookStudioReferences(access.orgId, data)
    if (referenceError) return referenceError

    const ref = await adminDb.collection(collectionName).add({
      ...data,
      ...actorFields(user),
    })

    return apiSuccess({ id: ref.id, resource }, 201)
  })

  return { GET, POST }
}
