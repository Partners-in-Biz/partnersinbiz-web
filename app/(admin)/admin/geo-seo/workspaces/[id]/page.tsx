import { notFound } from 'next/navigation'
import { GeoSeoWorkspaceDetail } from '@/components/geo-seo/GeoSeoWorkspaceDetail'
import { loadGeoSeoWorkspace } from '@/lib/geo-seo/workspaces'

export const dynamic = 'force-dynamic'

export default async function AdminGeoSeoWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workspace = await loadGeoSeoWorkspace(id)
  if (!workspace) notFound()

  return (
    <GeoSeoWorkspaceDetail
      workspace={workspace}
      backHref="/admin/geo-seo"
    />
  )
}
