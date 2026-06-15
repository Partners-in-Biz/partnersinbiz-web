import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { CaptureSourcesWorkspace } from '@/components/capture-sources/CaptureSourcesWorkspace'

export const dynamic = 'force-dynamic'

export default async function AdminOrgCaptureSourcesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const snap = await adminDb
    .collection('organizations')
    .where('slug', '==', slug)
    .limit(1)
    .get()

  if (snap.empty) notFound()

  const orgDoc = snap.docs[0]
  const org = orgDoc.data() ?? {}
  const orgName = typeof org.name === 'string' && org.name.trim() ? org.name.trim() : slug
  const encodedSlug = encodeURIComponent(slug)

  return (
    <CaptureSourcesWorkspace
      orgId={orgDoc.id}
      orgName={orgName}
      importHref={`/admin/org/${encodedSlug}/capture-sources/import`}
      sequenceNewHref={`/admin/sequences?org=${encodedSlug}`}
      surface="admin-org"
    />
  )
}
