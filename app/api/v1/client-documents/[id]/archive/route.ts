import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocument } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function actorType(user: ApiUser) {
  return actorFrom(user).createdByType === 'agent' ? 'agent' : 'user'
}

function assertDocumentDataAccess(document: Partial<ClientDocument>, user: ApiUser) {
  if (!document.orgId) {
    if (user.role === 'client') return { ok: false as const, response: apiError('Forbidden', 403) }
    return { ok: true as const }
  }

  const scope = resolveOrgScope(user, document.orgId)
  if (!scope.ok) return { ok: false as const, response: apiError(scope.error, scope.status) }

  return { ok: true as const }
}

export const POST = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params

  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)
  const result = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(documentRef)
    if (!snap.exists || snap.data()?.deleted === true) {
      return { ok: false as const, response: apiError('Document not found', 404) }
    }

    const access = assertDocumentDataAccess(snap.data() as Partial<ClientDocument>, user)
    if (!access.ok) return access

    transaction.update(documentRef, {
      status: 'archived',
      deleted: true,
      ...lastActorFrom(user),
    })

    return { ok: true as const }
  })

  if (!result.ok) return result.response

  return apiSuccess({ id, status: 'archived' })
})
