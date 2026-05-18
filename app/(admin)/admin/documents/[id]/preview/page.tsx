import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getCurrentAdminUserFromCookies } from '@/lib/api/currentAdmin'
import { canAccessOrg, isSuperAdmin } from '@/lib/api/platformAdmin'
import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'
import { PreviewFrame } from '@/components/client-documents/PreviewFrame'
import { deserializeBlocksFromFirestore } from '@/lib/client-documents/firestore-blocks'
import { serializeForClient } from '@/lib/client-documents/serialize'
import type { ClientDocument, ClientDocumentVersion } from '@/lib/client-documents/types'

export const dynamic = 'force-dynamic'

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(process.env.SESSION_COOKIE_NAME ?? '__session')?.value
  if (!sessionCookie) redirect('/login')

  try {
    await adminAuth.verifySessionCookie(sessionCookie, true)
  } catch {
    redirect('/login')
  }
  const user = await getCurrentAdminUserFromCookies()
  if (!user) redirect('/login')

  const docSnap = await adminDb.collection('client_documents').doc(id).get()
  if (!docSnap.exists) notFound()
  const doc = { id: docSnap.id, ...docSnap.data() } as ClientDocument
  if (doc.deleted) notFound()
  if (doc.orgId) {
    if (!canAccessOrg(user, doc.orgId)) notFound()
  } else if (!isSuperAdmin(user)) {
    notFound()
  }

  const versionSnap = await adminDb
    .collection('client_documents')
    .doc(id)
    .collection('versions')
    .doc(doc.currentVersionId)
    .get()
  if (!versionSnap.exists) notFound()
  const versionData = versionSnap.data()!
  const version = {
    id: versionSnap.id,
    ...versionData,
    blocks: deserializeBlocksFromFirestore(versionData.blocks),
  } as ClientDocumentVersion

  const versionLabel = `${doc.status === 'internal_draft' ? 'Draft' : doc.status} · v${version.versionNumber}`
  const shareUrl = doc.shareEnabled && doc.shareToken
    ? `${process.env.NEXT_PUBLIC_APP_URL}/d/${doc.shareToken}`
    : undefined

  return (
    <PreviewFrame
      backHref={`/admin/documents/${id}`}
      versionLabel={versionLabel}
      shareUrl={shareUrl}
    >
      <DocumentRenderer document={serializeForClient(doc)} version={serializeForClient(version)} />
    </PreviewFrame>
  )
}
