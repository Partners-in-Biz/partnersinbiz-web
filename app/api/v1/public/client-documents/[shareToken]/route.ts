import { NextRequest, NextResponse } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api/response'
import { deserializeBlocksFromFirestore } from '@/lib/client-documents/firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { stripPrivateDocumentFields } from '@/lib/client-documents/public'
import type { ClientDocument } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ shareToken: string }> }

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { shareToken } = await context.params
    if (!shareToken || shareToken.length < 8) return apiError('Invalid share token', 400)

    const snap = await adminDb
      .collection(CLIENT_DOCUMENTS_COLLECTION)
      .where('shareToken', '==', shareToken)
      .limit(1)
      .get()

    if (snap.empty) return apiError('Document not found', 404)

    const doc = snap.docs[0]
    const document = { id: doc.id, ...doc.data() } as ClientDocument
    if (document.deleted === true) return apiError('Document not found', 404)
    if (document.shareEnabled !== true) return apiError('Share link disabled', 403)
    if (typeof document.latestPublishedVersionId !== 'string' || !document.latestPublishedVersionId) {
      return apiError('Published version not found', 404)
    }

    const versionSnap = await adminDb
      .collection(CLIENT_DOCUMENTS_COLLECTION)
      .doc(doc.id)
      .collection('versions')
      .doc(document.latestPublishedVersionId)
      .get()

    if (!versionSnap.exists) return apiError('Published version not found', 404)

    const versionData = versionSnap.data()!
    const version = { id: versionSnap.id, ...versionData, blocks: deserializeBlocksFromFirestore(versionData.blocks) }
    return apiSuccess({
      document: stripPrivateDocumentFields(document),
      version: stripPrivateDocumentFields(version),
    })
  } catch (err) {
    console.error('[public/client-documents]', err)
    return apiError('Internal Server Error', 500)
  }
}
