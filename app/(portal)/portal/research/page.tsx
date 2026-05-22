import { ResearchListClient } from '@/components/research/ResearchListClient'

export const dynamic = 'force-dynamic'

export default function PortalResearchPage() {
  return (
    <ResearchListClient
      mode="portal"
      title="Research"
      description="Shared research findings, evidence, and recommendations from Partners in Biz."
      basePath="/portal/research"
    />
  )
}
