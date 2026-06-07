import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { GeoSeoWorkspace } from '@/components/geo-seo/GeoSeoWorkspace'
import { loadGeoSeoWorkspaces } from '@/lib/geo-seo/workspaces'

export const dynamic = 'force-dynamic'

export default async function OrgGeoSeoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const orgSnap = await adminDb.collection('organizations').where('slug', '==', slug).limit(1).get()
  if (orgSnap.empty) notFound()

  const orgId = orgSnap.docs[0].id
  const org = orgSnap.docs[0].data()
  const orgName = typeof org.name === 'string' && org.name ? org.name : slug
  const workspaces = await loadGeoSeoWorkspaces(orgId)

  return (
    <GeoSeoWorkspace
      workspaces={workspaces}
      basePath={`/admin/org/${encodeURIComponent(slug)}/geo-seo`}
      emptyActionHref={`/admin/geo-seo/workspaces/new?orgId=${encodeURIComponent(orgId)}&siteName=${encodeURIComponent(orgName)}`}
    />
  )
}
