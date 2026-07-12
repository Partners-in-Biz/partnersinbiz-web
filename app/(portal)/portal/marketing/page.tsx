import { MarketingStudioDashboard } from '@/components/email-marketing/MarketingStudioDashboard'

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
    <MarketingStudioDashboard
      scope={{
        orgId: params?.orgId,
        orgSlug: params?.orgSlug,
        sourceCompanyId: params?.sourceCompanyId,
        sourceCompanyName: params?.sourceCompanyName,
      }}
    />
  )
}
