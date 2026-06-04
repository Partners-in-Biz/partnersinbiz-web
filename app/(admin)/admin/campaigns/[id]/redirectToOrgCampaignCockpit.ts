import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { loadCampaignWithAssets } from '@/lib/campaigns/load'
import { resolveOrgSlugForLink } from '@/lib/projects/links'

export async function redirectToOrgCampaignCockpit(id: string, tab?: string): Promise<never> {
  const loaded = await loadCampaignWithAssets(id)
  if (!loaded) notFound()

  const orgId = typeof loaded.campaign.orgId === 'string' ? loaded.campaign.orgId.trim() : ''
  if (!orgId) redirect('/admin/campaigns')

  const orgSlug = await resolveOrgSlugForLink(adminDb, orgId)
  if (!orgSlug) redirect('/admin/campaigns')

  const destination = new URL(
    `/admin/org/${encodeURIComponent(orgSlug)}/social/${encodeURIComponent(id)}`,
    'https://partnersinbiz.online',
  )
  if (tab) destination.searchParams.set('tab', tab)

  redirect(`${destination.pathname}${destination.search}`)
}
