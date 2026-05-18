import { notFound } from 'next/navigation'

import { DocumentRenderer } from '@/components/client-documents'
import { deserializeBlocksFromFirestore } from '@/lib/client-documents/firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { stripPrivateDocumentFields } from '@/lib/client-documents/public'
import type { ClientDocument, ClientDocumentVersion } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ shareToken: string }> }

async function loadSharedDocument(shareToken: string) {
  if (!shareToken || shareToken.length < 8) return null

  const snap = await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .where('shareToken', '==', shareToken)
    .limit(1)
    .get()

  if (snap.empty) return null

  const documentSnap = snap.docs[0]
  const document = { id: documentSnap.id, ...documentSnap.data() } as ClientDocument
  if (document.deleted === true || document.shareEnabled !== true || !document.latestPublishedVersionId) return null

  const versionSnap = await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .doc(documentSnap.id)
    .collection('versions')
    .doc(document.latestPublishedVersionId)
    .get()

  if (!versionSnap.exists) return null

  const versionData = versionSnap.data()!
  return {
    document: stripPrivateDocumentFields(document) as ClientDocument,
    version: stripPrivateDocumentFields({
      id: versionSnap.id,
      ...versionData,
      blocks: deserializeBlocksFromFirestore(versionData.blocks),
    }) as ClientDocumentVersion,
  }
}

export default async function SharedDocumentPage({ params }: PageProps) {
  const { shareToken } = await params
  const shared = await loadSharedDocument(shareToken)
  if (!shared) notFound()

  return <DocumentRenderer document={shared.document} version={shared.version} />
}
