import type { EditorTimeline, VideoEditorProjectSettings } from './types'

export interface VideoEditorRuntimeConfig {
  submitUrl?: string
  previewSubmitUrl?: string
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
  const previewSubmitUrl = cleanString(env.VIDEO_EDITOR_PREVIEW_SUBMIT_URL)
    ?? (baseUrl ? `${baseUrl}/video-editor/media-previews` : undefined)
  return {
    ...(submitUrl ? { submitUrl } : {}),
    ...(previewSubmitUrl ? { previewSubmitUrl } : {}),
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
  effectAssets: Array<{ clipId: string; effectIndex: number; url: string }>
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
  const effectAssets: VideoEditorRenderManifest['effectAssets'] = []
  for (const track of input.timeline.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if (clip.media) media.push({ clipId: clip.id, url: clip.media.url, mediaKind: clip.media.mediaKind })
      const effects = Array.isArray(clip.effects) ? clip.effects : []
      effects.forEach((effect, effectIndex) => {
        const lutUrl = effect.kind === 'lut' && typeof effect.params?.lutUrl === 'string' ? effect.params.lutUrl : ''
        if (/^https:\/\//.test(lutUrl)) effectAssets.push({ clipId: clip.id, effectIndex, url: lutUrl })
      })
    }
  }
  return {
    kind: 'video_editor_render',
    job: { id: input.jobId, orgId: input.orgId, projectId: input.projectId },
    settings: input.settings,
    timeline: input.timeline,
    media,
    effectAssets,
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

export const VIDEO_EDITOR_PROXY_CAP_BYTES = Number(process.env.VIDEO_EDITOR_PROXY_CAP_BYTES || 20 * 1024 * 1024 * 1024)

export interface VideoEditorMediaPreviewManifest {
  kind: 'video_editor_media_preview'
  preview: { id: string; orgId: string; mediaKey: string; url: string; mediaKind: string }
  options: { waveform: boolean; filmstrip: boolean; proxy: boolean }
  report: { method: 'PUT'; path: string }
  upload: { method: 'POST'; path: '/api/v1/upload'; folder: string }
  proxyLedger: { listPath: string; deletePathTemplate: string; capBytes: number }
}

export function buildMediaPreviewManifest(input: {
  previewId: string
  orgId: string
  mediaKey: string
  url: string
  mediaKind: string
}): VideoEditorMediaPreviewManifest {
  const org = encodeURIComponent(input.orgId)
  const isVideo = input.mediaKind === 'video'
  const isAudio = input.mediaKind === 'audio'
  return {
    kind: 'video_editor_media_preview',
    preview: { id: input.previewId, orgId: input.orgId, mediaKey: input.mediaKey, url: input.url, mediaKind: input.mediaKind },
    options: { waveform: isVideo || isAudio, filmstrip: isVideo, proxy: isVideo },
    report: { method: 'PUT', path: `/api/v1/video-editor/media-previews/${input.previewId}?orgId=${org}` },
    upload: { method: 'POST', path: '/api/v1/upload', folder: `video-editor/${input.orgId}/previews` },
    proxyLedger: {
      listPath: `/api/v1/video-editor/proxy-ledger?orgId=${org}`,
      deletePathTemplate: `/api/v1/video-editor/proxy-ledger/{id}?orgId=${org}`,
      capBytes: VIDEO_EDITOR_PROXY_CAP_BYTES,
    },
  }
}

export async function dispatchMediaPreviewJob(
  manifest: VideoEditorMediaPreviewManifest,
  config: VideoEditorRuntimeConfig,
): Promise<{ providerJobId: string }> {
  if (!config.previewSubmitUrl) {
    throw new Error('Media preview runtime is not configured (set HIGGSFIELD_RUNTIME_URL or VIDEO_EDITOR_PREVIEW_SUBMIT_URL)')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  const response = await fetch(config.previewSubmitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...manifest,
      callback: { url: config.callbackBaseUrl ? `${config.callbackBaseUrl}/api/v1/video-editor/media-previews/${manifest.preview.id}` : undefined },
    }),
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`Executor rejected the preview job (${response.status}): ${text.slice(0, 300)}`)
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) as Record<string, unknown> } catch { body = {} }
  const providerJobId = typeof body.providerJobId === 'string' ? body.providerJobId : ''
  if (!providerJobId) throw new Error('Executor accepted the preview job but returned no providerJobId')
  return { providerJobId }
}
