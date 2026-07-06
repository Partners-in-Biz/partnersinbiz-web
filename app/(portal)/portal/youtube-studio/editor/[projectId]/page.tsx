import { VideoEditorShell } from '@/components/video-editor/VideoEditorShell'

export const dynamic = 'force-dynamic'

type PageContext = {
  params: Promise<{ projectId: string }>
  searchParams?: Promise<{ orgId?: string | string[] }>
}

function firstSearchParam(value?: string | string[]) {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first.trim() : ''
}

export default async function YouTubeStudioEditorPage({ params, searchParams }: PageContext) {
  const { projectId } = await params
  const query = await searchParams
  return <VideoEditorShell projectId={projectId} orgId={firstSearchParam(query?.orgId) || undefined} />
}
