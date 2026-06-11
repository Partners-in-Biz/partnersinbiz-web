import { notFound } from 'next/navigation'
import { GeoSeoWorkspaceDetail } from '@/components/geo-seo/GeoSeoWorkspaceDetail'
import { adminDb } from '@/lib/firebase/admin'
import { loadGeoSeoWorkspace } from '@/lib/geo-seo/workspaces'

export const dynamic = 'force-dynamic'

export default async function AdminOrgGeoSeoWorkspacePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  const orgSnap = await adminDb.collection('organizations').where('slug', '==', slug).limit(1).get()
  if (orgSnap.empty) notFound()

  const workspace = await loadGeoSeoWorkspace(id, orgSnap.docs[0].id)
  if (!workspace) notFound()

  return (
    <GeoSeoWorkspaceDetail
      surface="admin"
      workspace={workspace}
      backHref={`/admin/org/${encodeURIComponent(slug)}/geo-seo`}
    />
  )
}
