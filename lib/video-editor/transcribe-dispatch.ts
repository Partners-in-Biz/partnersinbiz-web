export interface TranscriptionRuntimeConfig {
  submitUrl?: string
  apiKey?: string
  callbackBaseUrl?: string
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function transcriptionRuntimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TranscriptionRuntimeConfig {
  const baseUrl = cleanString(env.HIGGSFIELD_RUNTIME_URL)?.replace(/\/$/, '')
  const appUrl = (cleanString(env.NEXT_PUBLIC_APP_URL) ?? cleanString(env.NEXT_PUBLIC_BASE_URL))?.replace(/\/$/, '')
  const submitUrl = cleanString(env.VIDEO_EDITOR_TRANSCRIBE_SUBMIT_URL)
    ?? (baseUrl ? `${baseUrl}/video-editor/transcriptions` : undefined)
  return {
    ...(submitUrl ? { submitUrl } : {}),
    ...(cleanString(env.HIGGSFIELD_RUNTIME_API_KEY) ? { apiKey: cleanString(env.HIGGSFIELD_RUNTIME_API_KEY) } : {}),
    ...(appUrl ? { callbackBaseUrl: appUrl } : {}),
  }
}

export interface VideoEditorTranscriptionManifest {
  kind: 'video_editor_transcription'
  job: { id: string; orgId: string; projectId: string }
  media: { url: string; mediaKind: 'video' | 'audio' }
  language?: string
  /** BYOK override — scoped to this job only; the executor must never persist it. */
  byok?: { apiKey: string; baseUrl?: string; model?: string }
  report: { method: 'PUT'; path: string }
}

export function buildTranscriptionManifest(input: {
  transcriptId: string
  orgId: string
  projectId: string
  media: { url: string; mediaKind: 'video' | 'audio' }
  language?: string
  byok?: { apiKey: string; baseUrl?: string; model?: string }
}): VideoEditorTranscriptionManifest {
  return {
    kind: 'video_editor_transcription',
    job: { id: input.transcriptId, orgId: input.orgId, projectId: input.projectId },
    media: input.media,
    ...(input.language ? { language: input.language } : {}),
    ...(input.byok ? { byok: input.byok } : {}),
    report: {
      method: 'PUT',
      path: `/api/v1/video-editor/transcripts/${input.transcriptId}?orgId=${encodeURIComponent(input.orgId)}`,
    },
  }
}

export async function dispatchTranscriptionJob(
  manifest: VideoEditorTranscriptionManifest,
  config: TranscriptionRuntimeConfig,
): Promise<{ providerJobId: string }> {
  if (!config.submitUrl) {
    throw new Error('Transcription runtime is not configured (set HIGGSFIELD_RUNTIME_URL or VIDEO_EDITOR_TRANSCRIBE_SUBMIT_URL)')
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
          ? `${config.callbackBaseUrl}/api/v1/video-editor/transcripts/${manifest.job.id}`
          : undefined,
      },
    }),
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`Executor rejected the transcription (${response.status}): ${text.slice(0, 300)}`)
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) as Record<string, unknown> } catch { body = {} }
  const providerJobId = typeof body.providerJobId === 'string' ? body.providerJobId : ''
  if (!providerJobId) throw new Error('Executor accepted the transcription but returned no providerJobId')
  return { providerJobId }
}
