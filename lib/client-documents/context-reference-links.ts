import { FieldValue } from 'firebase-admin/firestore'

import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ContextReference } from '@/lib/context-references/types'
import { adminDb } from '@/lib/firebase/admin'

function uniqueIds(refs: ContextReference[], type: 'contact' | 'company') {
  return Array.from(new Set(refs.filter((ref) => ref.type === type).map((ref) => ref.id).filter(Boolean)))
}

export async function promoteCrmContextRefsToDocumentLinks(documentId: string, refs: ContextReference[]) {
  const contactIds = uniqueIds(refs, 'contact')
  const companyIds = uniqueIds(refs, 'company')

  if (contactIds.length === 0 && companyIds.length === 0) return

  await adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(documentId).update({
    ...(contactIds.length > 0 ? { 'linked.contactIds': FieldValue.arrayUnion(...contactIds) } : {}),
    ...(companyIds.length > 0 ? { 'linked.companyIds': FieldValue.arrayUnion(...companyIds) } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  })
}
