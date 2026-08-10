import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { DocumentSuggestion } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_KINDS: DocumentSuggestion['kind'][] = ['replace_text', 'insert_text', 'delete_text', 'replace_block']

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user, 'suggest')
  if (!access.ok) return access.response

  const snap = await adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('suggestions').get()
  return apiSuccess(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user, 'suggest')
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const blockId = typeof body.blockId === 'string' ? body.blockId.trim() : ''
  if (!blockId) return apiError('blockId is required', 400)

  if (!VALID_KINDS.includes(body.kind)) {
    return apiError(`kind must be one of: ${VALID_KINDS.join(', ')}`, 400)
  }

  if (body.proposed === undefined) return apiError('proposed is required', 400)
  if (body.versionId !== undefined && typeof body.versionId !== 'string') {
    return apiError('versionId must be a string', 400)
  }

  const ref = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('suggestions').doc()
  await ref.set({
    documentId: id,
    versionId: body.versionId ?? access.document.currentVersionId,
    blockId,
    kind: body.kind,
    original: body.original ?? null,
    proposed: body.proposed,
    status: 'open',
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id: ref.id }, 201)
})
