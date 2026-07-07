import { videoEditorRuntimeConfigFromEnv } from './dispatch'
import type { VideoEditorRuntimeConfig } from './dispatch'

export interface BeatAnalysisManifest {
  kind: 'video_editor_beats'
  uploadId: string
  orgId: string
  media: { url: string }
  report: { method: 'PUT'; path: string }
}

export function buildBeatAnalysisManifest(input: {
  uploadId: string
  orgId: string
  mediaUrl: string
}): BeatAnalysisManifest {
  return {
    kind: 'video_editor_beats',
    uploadId: input.uploadId,
    orgId: input.orgId,
    media: { url: input.mediaUrl },
    report: {
      method: 'PUT',
      path: `/api/v1/video-editor/media/${input.uploadId}/beats?orgId=${encodeURIComponent(input.orgId)}`,
    },
  }
}

export async function dispatchBeatAnalysis(
  manifest: BeatAnalysisManifest,
  config: VideoEditorRuntimeConfig = videoEditorRuntimeConfigFromEnv(),
): Promise<{ providerJobId: string }> {
  if (!config.beatSubmitUrl) {
    throw new Error('Beat analysis runtime is not configured (set HIGGSFIELD_RUNTIME_URL or VIDEO_EDITOR_BEATS_SUBMIT_URL)')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  const response = await fetch(config.beatSubmitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...manifest,
      callback: {
        url: config.callbackBaseUrl ? `${config.callbackBaseUrl}${manifest.report.path}` : undefined,
      },
    }),
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`Executor rejected beat analysis (${response.status}): ${text.slice(0, 300)}`)
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = {}
  }
  const providerJobId = typeof body.providerJobId === 'string' ? body.providerJobId : ''
  if (!providerJobId) throw new Error('Executor accepted beat analysis but returned no providerJobId')
  return { providerJobId }
}
