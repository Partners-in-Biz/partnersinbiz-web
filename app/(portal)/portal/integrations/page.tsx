import { IntegrationsGrid } from '@/components/integrations/IntegrationsGrid'
import { IntegrationsWorkspace } from '@/components/integrations/IntegrationsWorkspace'

export const dynamic = 'force-dynamic'

type PortalIntegrationsSearchParams = {
  orgId?: string
}

export default async function PortalIntegrationsPage({
  searchParams,
}: {
  searchParams?: Promise<PortalIntegrationsSearchParams>
}) {
  const params = await searchParams
  return (
    <div className="space-y-10">
      <IntegrationsGrid orgId={params?.orgId} />
      <IntegrationsWorkspace orgId={params?.orgId} />
    </div>
  )
}
