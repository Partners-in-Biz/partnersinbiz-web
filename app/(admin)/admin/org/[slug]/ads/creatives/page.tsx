import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listCreatives } from '@/lib/ads/creatives/store'
import { CreativesPanelClient } from './CreativesPanelClient'

interface Params {
  slug: string
}

export default async function CreativesLibraryPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <p className="pib-page-sub">Org not found.</p>

  const creatives = await listCreatives({ orgId })

  return <CreativesPanelClient orgId={orgId} orgSlug={slug} initialCreatives={creatives} />
}
