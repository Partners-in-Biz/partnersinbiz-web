import { YouTubeStudioPortalWorkspace } from '@/components/youtube-studio/YouTubeStudioPortalWorkspace'

export const dynamic = 'force-dynamic'

type PortalYouTubeStudioSearchParams = {
  orgId?: string | string[]
}

function firstSearchParam(value?: string | string[]) {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first.trim() : ''
}

export default async function PortalYouTubeStudioPage({
  searchParams,
}: {
  searchParams?: Promise<PortalYouTubeStudioSearchParams>
} = {}) {
  const params = await searchParams
  const orgId = firstSearchParam(params?.orgId)

  return <YouTubeStudioPortalWorkspace orgId={orgId || undefined} />
}
