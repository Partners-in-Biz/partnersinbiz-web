import { CreativeCanvasWorkspace } from '@/components/creative-canvas/CreativeCanvasWorkspace'

export const dynamic = 'force-dynamic'

interface CreativeCanvasAdminPageProps {
  searchParams?: Promise<{ orgId?: string }>
}

export default async function CreativeCanvasAdminPage({ searchParams }: CreativeCanvasAdminPageProps) {
  const params = await searchParams
  const orgId = typeof params?.orgId === 'string' ? params.orgId : undefined

  return <CreativeCanvasWorkspace mode="admin" orgId={orgId} />
}
