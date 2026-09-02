import { ResearchDetailClient } from '@/components/research/ResearchDetailClient'
import { CompanyWorkRecordControls } from '@/components/crm/CompanyWorkRecordControls'
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
    <>
      <CompanyWorkRecordControls className="mb-4" module="research" recordId={id} orgId={scope.orgId} />
      <ResearchDetailClient
        id={id}
        mode="portal"
        basePath={scopedPortalPath('/portal/research', scope)}
        orgId={scope.orgId}
      />
    </>
  )
}
