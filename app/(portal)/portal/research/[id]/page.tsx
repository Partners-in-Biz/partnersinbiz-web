import { ResearchDetailClient } from '@/components/research/ResearchDetailClient'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

type SearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

type Props = {
  params: Promise<{ id: string }>
  searchParams?: Promise<SearchParams>
}

export default async function PortalResearchDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const scope = (await searchParams) ?? {}

  return (
    <ResearchDetailClient
      id={id}
      mode="portal"
      basePath={scopedPortalPath('/portal/research', scope)}
      orgId={scope.orgId}
    />
  )
}
