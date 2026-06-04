import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { loadCampaignWithAssets } from '@/lib/campaigns/load'
import { resolveOrgSlugForLink } from '@/lib/projects/links'

export const dynamic = 'force-dynamic'

export default async function CampaignOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const loaded = await loadCampaignWithAssets(id)
  if (!loaded) notFound()

  const orgId = typeof loaded.campaign.orgId === 'string' ? loaded.campaign.orgId.trim() : ''
  if (!orgId) redirect('/admin/campaigns')

  const orgSlug = await resolveOrgSlugForLink(adminDb, orgId)
  if (!orgSlug) redirect('/admin/campaigns')

  redirect(`/admin/org/${encodeURIComponent(orgSlug)}/social/${encodeURIComponent(id)}`)
}
