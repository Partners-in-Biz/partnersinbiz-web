import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { assertClientDocumentDataAccess } from '@/lib/client-documents/access'
import { deserializeBlocksFromFirestore, serializeBlocksForFirestore } from '@/lib/client-documents/firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocument, DocumentTheme } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; versionId: string }> }

function actorType(user: ApiUser) {
  return user.role === 'ai' ? 'agent' : 'user'
}

export const POST = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id, versionId } = await ctx.params

  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)
  const sourceVersionRef = documentRef.collection('versions').doc(versionId)
  const newVersionRef = documentRef.collection('versions').doc()
  const inputActorType = actorType(user)

  let result: { ok: true } | { ok: false; response: ReturnType<typeof apiError> }
  try {
    result = await adminDb.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(documentRef)
      if (!docSnap.exists || docSnap.data()?.deleted === true) {
        return { ok: false as const, response: apiError('Document not found', 404) }
      }

      const access = assertClientDocumentDataAccess(docSnap.data() as Partial<ClientDocument>, user)
      if (!access.ok) return access

      const versionSnap = await transaction.get(sourceVersionRef)
      if (!versionSnap.exists) {
        return { ok: false as const, response: apiError('Version not found', 404) }
      }

      const sourceData = versionSnap.data()!
      const sourceVersionNumber =
        typeof sourceData.versionNumber === 'number' ? sourceData.versionNumber : null
      const blocks = deserializeBlocksFromFirestore(sourceData.blocks)
      const theme = (sourceData.theme ?? undefined) as DocumentTheme | undefined
      const storedBlocks = serializeBlocksForFirestore(blocks)

      transaction.set(newVersionRef, {
        documentId: id,
        versionNumber: Date.now(),
        status: 'draft',
        blocks: storedBlocks,
        ...(theme ? { theme } : {}),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: user.uid,
        createdByType: inputActorType,
        changeSummary:
          sourceVersionNumber != null
            ? `Restored from version ${sourceVersionNumber}`
            : 'Restored from a previous version',
      })
      transaction.update(documentRef, {
        currentVersionId: newVersionRef.id,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
        updatedByType: inputActorType,
      })

      return { ok: true as const }
    })
  } catch (err) {
    console.error('[client-documents/versions/restore] POST failed', { documentId: id, versionId, error: err })
    return apiError('Internal Server Error', 500)
  }

  if (!result.ok) return result.response

  return apiSuccess({ id: newVersionRef.id }, 201)
})
