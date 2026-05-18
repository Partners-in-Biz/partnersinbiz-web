import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'
import { PreviewFrame } from '@/components/client-documents/PreviewFrame'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import { deserializeBlocksFromFirestore } from '@/lib/client-documents/firestore-blocks'
import { serializeForClient } from '@/lib/client-documents/serialize'
import type { ClientDocument, ClientDocumentVersion } from '@/lib/client-documents/types'

export const dynamic = 'force-dynamic'

export default async function OrgPreviewPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(process.env.SESSION_COOKIE_NAME ?? '__session')?.value
  if (!sessionCookie) redirect('/login')

  try {
    await adminAuth.verifySessionCookie(sessionCookie, true)
  } catch {
    redirect('/login')
  }

  const orgSnap = await adminDb.collection('organizations').where('slug', '==', slug).limit(1).get()
  if (orgSnap.empty) notFound()
  const org = { id: orgSnap.docs[0].id, ...orgSnap.docs[0].data() } as { id: string; name: string }

  const docSnap = await adminDb.collection('client_documents').doc(id).get()
  if (!docSnap.exists) notFound()
  const doc = { id: docSnap.id, ...docSnap.data() } as ClientDocument
  if (doc.deleted) notFound()
  if (doc.orgId !== org.id) notFound()

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
    <OrgThemedFrame orgId={org.id}>
      <PreviewFrame
        backHref={`/admin/org/${slug}/documents/${id}`}
        versionLabel={versionLabel}
        shareUrl={shareUrl}
      >
        <DocumentRenderer document={serializeForClient(doc)} version={serializeForClient(version)} />
      </PreviewFrame>
    </OrgThemedFrame>
  )
}
