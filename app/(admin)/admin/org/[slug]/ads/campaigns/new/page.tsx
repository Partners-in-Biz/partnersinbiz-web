// app/(admin)/admin/org/[slug]/ads/campaigns/new/page.tsx
// Sub-3a Phase 2 Batch 4  -  platform picker replaces Meta-only gate.
// Meta still needs a connection; Google wizard requires none at this page level
// (Google connection is validated server-side when the campaign is submitted).

import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getConnection } from '@/lib/ads/connections/store'
import { NewCampaignClient } from './NewCampaignClient'

interface Params {
  slug: string
}

export default async function NewCampaignPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="pib-empty-state-description">Org not found.</div>

  const [meta, google] = await Promise.all([
    getConnection({ orgId, platform: 'meta' }),
    getConnection({ orgId, platform: 'google' }),
  ])

  // At least one platform must be connected to create a campaign.
  if (!meta && !google) {
    return (
      <div className="pib-card">
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          No ad platform connected. Connect Meta or Google Ads first under{' '}
          <a href={`/admin/org/${slug}/ads/connections`} className="text-[var(--st-danger)] underline">
            Connections
          </a>
          .
        </p>
      </div>
    )
  }

  const adAccount = meta?.adAccounts?.find((a) => a.id === meta.defaultAdAccountId)

  return (
    <NewCampaignClient
      orgId={orgId}
      orgSlug={slug}
      currency={adAccount?.currency ?? 'USD'}
    />
  )
}
