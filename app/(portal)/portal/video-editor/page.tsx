import { VideoEditorPortalWorkspace } from '@/components/video-editor/VideoEditorPortalWorkspace'

export const dynamic = 'force-dynamic'

type PortalVideoEditorSearchParams = {
  orgId?: string | string[]
  projectId?: string | string[]
}

function firstSearchParam(value?: string | string[]) {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first.trim() : ''
}

export default async function PortalVideoEditorPage({
  searchParams,
}: {
  searchParams?: Promise<PortalVideoEditorSearchParams>
}) {
  const params = await searchParams
  return (
    <VideoEditorPortalWorkspace
      orgId={firstSearchParam(params?.orgId) || undefined}
      projectId={firstSearchParam(params?.projectId) || undefined}
    />
  )
}
