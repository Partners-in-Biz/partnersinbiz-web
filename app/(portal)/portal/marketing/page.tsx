import { HubPage } from '@/components/navigation/HubPage'
import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'

export const dynamic = 'force-dynamic'

type PortalMarketingSearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

export default async function PortalMarketingPage({
  searchParams,
}: {
  searchParams?: Promise<PortalMarketingSearchParams>
}) {
  const params = await searchParams

  return (
    <HubPage
      {...buildMarketingHubProps({
        surface: 'portal',
        orgId: params?.orgId,
        orgSlug: params?.orgSlug,
        sourceCompanyId: params?.sourceCompanyId,
        sourceCompanyName: params?.sourceCompanyName,
      })}
    />
  )
}
