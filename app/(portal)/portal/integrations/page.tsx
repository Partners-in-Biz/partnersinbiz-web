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
  return <IntegrationsWorkspace orgId={params?.orgId} />
}
