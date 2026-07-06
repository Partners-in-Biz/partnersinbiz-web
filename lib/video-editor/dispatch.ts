import type { EditorTimeline, VideoEditorProjectSettings } from './types'

export interface VideoEditorRuntimeConfig {
  submitUrl?: string
  apiKey?: string
  callbackBaseUrl?: string
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function videoEditorRuntimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VideoEditorRuntimeConfig {
  const baseUrl = cleanString(env.HIGGSFIELD_RUNTIME_URL)?.replace(/\/$/, '')
  const appUrl = (cleanString(env.NEXT_PUBLIC_APP_URL) ?? cleanString(env.NEXT_PUBLIC_BASE_URL))?.replace(/\/$/, '')
  const submitUrl = cleanString(env.VIDEO_EDITOR_RUNTIME_SUBMIT_URL) ?? (baseUrl ? `${baseUrl}/video-editor/renders` : undefined)
  return {
    ...(submitUrl ? { submitUrl } : {}),
    ...(cleanString(env.HIGGSFIELD_RUNTIME_API_KEY) ? { apiKey: cleanString(env.HIGGSFIELD_RUNTIME_API_KEY) } : {}),
    ...(appUrl ? { callbackBaseUrl: appUrl } : {}),
  }
}

export interface VideoEditorRenderManifest {
  kind: 'video_editor_render'
  job: { id: string; orgId: string; projectId: string }
  settings: VideoEditorProjectSettings
  timeline: EditorTimeline
  media: Array<{ clipId: string; url: string; mediaKind: string }>
  report: { method: 'PUT'; path: string }
  upload: { method: 'POST'; path: '/api/v1/upload'; folder: string; filename: string }
}

export function buildVideoEditorRenderManifest(input: {
  jobId: string
  orgId: string
  projectId: string
  timeline: EditorTimeline
  settings: VideoEditorProjectSettings
}): VideoEditorRenderManifest {
  const media: VideoEditorRenderManifest['media'] = []
  for (const track of input.timeline.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if (clip.media) media.push({ clipId: clip.id, url: clip.media.url, mediaKind: clip.media.mediaKind })
    }
  }
  return {
    kind: 'video_editor_render',
    job: { id: input.jobId, orgId: input.orgId, projectId: input.projectId },
    settings: input.settings,
    timeline: input.timeline,
    media,
    report: { method: 'PUT', path: `/api/v1/video-editor/render-jobs/${input.jobId}?orgId=${encodeURIComponent(input.orgId)}` },
    upload: {
      method: 'POST',
      path: '/api/v1/upload',
      folder: `video-editor/${input.orgId}/${input.projectId}`,
      filename: `${input.jobId}.mp4`,
    },
  }
}

export async function dispatchVideoEditorRenderJob(
  manifest: VideoEditorRenderManifest,
  config: VideoEditorRuntimeConfig,
): Promise<{ providerJobId: string }> {
  if (!config.submitUrl) {
    throw new Error('Video editor render runtime is not configured (set HIGGSFIELD_RUNTIME_URL or VIDEO_EDITOR_RUNTIME_SUBMIT_URL)')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  const response = await fetch(config.submitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...manifest,
      callback: {
        url: config.callbackBaseUrl
          ? `${config.callbackBaseUrl}/api/v1/video-editor/render-jobs/${manifest.job.id}`
          : undefined,
      },
    }),
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`Executor rejected the render (${response.status}): ${text.slice(0, 300)}`)
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = {}
  }
  const providerJobId = typeof body.providerJobId === 'string' ? body.providerJobId : ''
  if (!providerJobId) throw new Error('Executor accepted the render but returned no providerJobId')
  return { providerJobId }
}
