import { GeoSeoWorkspace } from '@/components/geo-seo/GeoSeoWorkspace'
import { loadGeoSeoWorkspaces } from '@/lib/geo-seo/workspaces'

export const dynamic = 'force-dynamic'

export default async function AdminGeoSeoPage() {
  const workspaces = await loadGeoSeoWorkspaces()
  return <GeoSeoWorkspace workspaces={workspaces} basePath="/admin/geo-seo" />
}
