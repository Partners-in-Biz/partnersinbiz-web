import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { deserializeBlocksFromFirestore, serializeBlocksForFirestore } from '@/lib/client-documents/firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { DocumentTheme } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; versionId: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id, versionId } = await ctx.params
  const access = await getAccessibleClientDocument(id, user, 'write', { item: versionId })
  if (!access.ok) return access.response

  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)
  const sourceVersionRef = documentRef.collection('versions').doc(versionId)
  const newVersionRef = documentRef.collection('versions').doc()
  const created = actorFrom(user)
  const updated = lastActorFrom(user)

  let result: { ok: true } | { ok: false; response: ReturnType<typeof apiError> }
  try {
    result = await adminDb.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(documentRef)
      if (!docSnap.exists || docSnap.data()?.deleted === true) {
        return { ok: false as const, response: apiError('Document not found', 404) }
      }

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
        createdBy: created.createdBy,
        createdByType: created.createdByType,
        ...(created.createdByAgentId ? { createdByAgentId: created.createdByAgentId } : {}),
        changeSummary:
          sourceVersionNumber != null
            ? `Restored from version ${sourceVersionNumber}`
            : 'Restored from a previous version',
      })
      transaction.update(documentRef, {
        currentVersionId: newVersionRef.id,
        updatedBy: updated.updatedBy,
        updatedByType: updated.updatedByType,
        updatedAt: updated.updatedAt,
        ...(updated.updatedByAgentId ? { updatedByAgentId: updated.updatedByAgentId } : {}),
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
