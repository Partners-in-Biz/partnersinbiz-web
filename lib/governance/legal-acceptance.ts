import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

interface PublishedLegalDoc {
  docType: string
  version: number
}

async function readPublishedLegalDocs(): Promise<PublishedLegalDoc[]> {
  try {
    const snap = await adminDb.collection('legal_documents').where('status', '==', 'published').get()
    return snap.docs.flatMap((doc) => {
      const data = doc.data() ?? {}
      const docType = typeof data.docType === 'string' ? data.docType : ''
      const version = Number(data.version) || 0
      return docType && version > 0 ? [{ docType, version }] : []
    })
  } catch {
    return []
  }
}

async function readAcceptedVersions(uid: string, email: string): Promise<Map<string, number>> {
  const accepted = new Map<string, number>()
  const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = []

  try {
    queries.push(adminDb.collection('legal_acceptances').where('userId', '==', uid).get())
  } catch {
    // ignore and fall back to email-based matches
  }

  if (email) {
    try {
      queries.push(adminDb.collection('legal_acceptances').where('userEmail', '==', email).get())
    } catch {
      // ignore
    }
  }

  const snapshots = await Promise.allSettled(queries)
  for (const result of snapshots) {
    if (result.status !== 'fulfilled') continue
    for (const doc of result.value.docs) {
      const data = doc.data() ?? {}
      const docType = typeof data.docType === 'string' ? data.docType : ''
      const version = Number(data.version) || 0
      if (!docType || version <= 0) continue
      const current = accepted.get(docType) ?? 0
      if (version > current) accepted.set(docType, version)
    }
  }

  return accepted
}

export async function markPendingLegalAcceptanceForLogin(input: {
  uid: string
  email: string
}): Promise<void> {
  const published = await readPublishedLegalDocs()
  if (published.length === 0) return

  const accepted = await readAcceptedVersions(input.uid, input.email.toLowerCase())
  const pending = published.filter((doc) => (accepted.get(doc.docType) ?? 0) < doc.version)

  await adminDb.collection('users').doc(input.uid).set({
    legalAcceptanceRequired: pending.length > 0,
    legalAcceptanceRequiredDocTypes: pending.map((doc) => doc.docType),
    legalAcceptanceRequiredVersions: pending.reduce<Record<string, number>>((acc, doc) => {
      acc[doc.docType] = doc.version
      return acc
    }, {}),
    legalAcceptanceLastCheckedAt: FieldValue.serverTimestamp(),
    legalAcceptancePendingSince: pending.length > 0 ? FieldValue.serverTimestamp() : null,
  }, { merge: true })
}
