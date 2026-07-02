import { CreativeCanvasWorkspace } from '@/components/creative-canvas/CreativeCanvasWorkspace'
import { PortalCanvasReviewSection } from '@/components/creative-canvas/portal/CanvasReviewPanel'

export const dynamic = 'force-dynamic'

interface CreativeCanvasPortalPageProps {
  searchParams?: Promise<{ orgId?: string }>
}

export default async function CreativeCanvasPortalPage({ searchParams }: CreativeCanvasPortalPageProps) {
  const params = await searchParams
  const orgId = typeof params?.orgId === 'string' ? params.orgId : undefined

  return (
    <div className="flex flex-col gap-6">
      <CreativeCanvasWorkspace mode="portal" orgId={orgId} />
      <PortalCanvasReviewSection orgId={orgId} />
    </div>
  )
}
