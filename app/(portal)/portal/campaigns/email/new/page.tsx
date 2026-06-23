import { notFound, redirect } from 'next/navigation'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import { NewEmailCampaignWizard } from '@/components/campaigns/NewEmailCampaignWizard'
import {
  resolvePortalCampaignUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalCampaignSearchParams,
} from '../../portalCampaignScope'

export const dynamic = 'force-dynamic'

export default async function NewEmailCampaignPage({
  searchParams,
}: {
  searchParams?: Promise<PortalCampaignSearchParams>
}) {
  const params = await searchParams
  const scope = scopeFromSearchParams(params)
  const user = await resolvePortalCampaignUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()
  if (!user.orgId) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        No organisation linked to this account.
      </div>
    )
  }

  const brandKit = await getBrandKitForOrg(user.orgId)

  const editHrefTemplate = scopedPortalHref('/portal/campaigns/email/__ID__/edit', scope)

  return (
    <NewEmailCampaignWizard
      orgId={user.orgId}
      backHref={scopedPortalHref('/portal/campaigns', scope)}
      editHrefTemplate={editHrefTemplate}
      defaultFromName={brandKit.defaultFromName || brandKit.brandName}
    />
  )
}
