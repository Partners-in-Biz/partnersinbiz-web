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

  const orgDoc = orgSnap.docs[0]
  const workspace = await loadGeoSeoWorkspace(id, orgDoc.id)
  if (!workspace) notFound()

  const orgScope = {
    orgId: orgDoc.id,
    orgSlug: slug,
    sourceCompanyId: workspace.sourceCompanyId || undefined,
    sourceCompanyName: workspace.sourceCompanyName || undefined,
  }

  return (
    <GeoSeoWorkspaceDetail
      surface="admin"
      workspace={workspace}
      orgScope={orgScope}
      backHref={`/admin/org/${encodeURIComponent(slug)}/geo-seo`}
    />
  )
}
