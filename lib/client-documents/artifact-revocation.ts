import { FieldValue } from 'firebase-admin/firestore'

import { adminDb } from '@/lib/firebase/admin'
import {
  collectDocumentArtifactStoragePaths,
  revokeDocumentArtifactTokens,
} from '@/lib/client-documents/artifacts'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'

/**
 * Rotate durable Firebase download tokens for every signed document artifact
 * currently referenced by the document. Call this after share disable, named
 * grant revoke, edit-share disable, or relationship/capability cascade so old
 * pdfSnapshotUrl values stop resolving.
 */
export async function revokeDocumentSignedArtifactAccess(documentId: string): Promise<{ revoked: number }> {
  const id = typeof documentId === 'string' ? documentId.trim() : ''
  if (!id) return { revoked: 0 }

  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)
  const [documentSnap, requestSnap] = await Promise.all([
    documentRef.get(),
    documentRef.collection('signature_requests').limit(100).get().catch(() => null),
  ])

  if (!documentSnap.exists) return { revoked: 0 }
  const document = documentSnap.data() ?? {}
  const requests = (requestSnap?.docs ?? []).map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  })) as Array<Record<string, unknown> & { id: string }>

  const paths = collectDocumentArtifactStoragePaths({
    signatureRequests: requests,
    signedByExternal: (document.signedByExternal as Record<string, unknown> | undefined) ?? null,
  })
  const revoked = await revokeDocumentArtifactTokens(paths)

  const batch = adminDb.batch()
  let writes = 0
  for (const request of requests) {
    if (typeof request.pdfSnapshotUrl === 'string' && request.pdfSnapshotUrl.trim()) {
      batch.update(documentRef.collection('signature_requests').doc(String(request.id)), {
        pdfSnapshotUrl: FieldValue.delete(),
        artifactAccessRevokedAt: new Date().toISOString(),
      })
      writes += 1
    }
  }
  if (document.signedByExternal && typeof (document.signedByExternal as { pdfSnapshotUrl?: unknown }).pdfSnapshotUrl === 'string') {
    batch.update(documentRef, {
      'signedByExternal.pdfSnapshotUrl': FieldValue.delete(),
      artifactAccessRevokedAt: FieldValue.serverTimestamp(),
    })
    writes += 1
  } else if (revoked > 0) {
    batch.update(documentRef, {
      artifactAccessRevokedAt: FieldValue.serverTimestamp(),
    })
    writes += 1
  }
  if (writes > 0) await batch.commit()

  return { revoked }
}
