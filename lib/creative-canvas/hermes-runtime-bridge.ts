import { createHash, timingSafeEqual } from 'crypto'
import { callHermesJson, createHermesRun, getHermesProfileLink } from '@/lib/hermes/server'
import type { HiggsfieldExecutionManifest } from './higgsfield-execution'
import type { CreativeCanvas, CreativeCanvasOutputKind, CreativeCanvasRun, CreativeCanvasRunStatus } from './types'

type RunWithId = CreativeCanvasRun & { id: string }

export interface CreativeCanvasHermesRuntimeRequest {
  providerKey: 'higgsfield'
  run: RunWithId
  canvas?: Pick<CreativeCanvas, 'id' | 'orgId' | 'title' | 'purpose'>
  manifest?: HiggsfieldExecutionManifest
  callback?: {
    url?: string
    secretConfigured?: boolean
  }
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function constantTimeStringEqual(candidate: string, expected: string | undefined): boolean {
  const expectedValue = expected ?? ''
  if (!expectedValue) return false
  const candidateHash = createHash('sha256').update(candidate).digest()
  const expectedHash = createHash('sha256').update(expectedValue).digest()
  return timingSafeEqual(candidateHash, expectedHash)
}

export function hasValidCreativeCanvasRuntimeKey(candidate: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!candidate?.startsWith('Bearer ')) return false
  return constantTimeStringEqual(candidate.slice('Bearer '.length), env.HIGGSFIELD_RUNTIME_API_KEY)
}

function parseRun(value: unknown): RunWithId | null {
  const run = asRecord(value)
  const id = cleanString(run.id)
  const orgId = cleanString(run.orgId)
  const canvasId = cleanString(run.canvasId)
  const nodeId = cleanString(run.nodeId)
  if (!id || !orgId || !canvasId || !nodeId || run.providerKey !== 'higgsfield') return null
  return run as unknown as RunWithId
}

function buildRuntimePrompt(input: CreativeCanvasHermesRuntimeRequest): string {
  const run = input.run
  const manifest = input.manifest
  const sourceLines = manifest?.sourceMedia?.length
    ? manifest.sourceMedia.map((source) => `- ${source.flag} ${source.value}${source.role ? ` (${source.role})` : ''}`).join('\n')
    : '- No source media attached'

  return [
    'You are Maya, the Partners in Biz creative production agent.',
    'Execute this Creative Canvas Higgsfield run through the authenticated Higgsfield CLI/runtime.',
    '',
    `Canvas: ${input.canvas?.title ?? run.canvasId}`,
    `Canvas purpose: ${input.canvas?.purpose ?? 'Internal creative production'}`,
    `Creative Canvas run id: ${run.id}`,
    `Organisation id: ${run.orgId}`,
    `Model: ${run.model ?? 'nano_banana_flash'}`,
    `Prompt summary: ${run.input.promptSummary ?? 'Generate a reviewable internal creative asset.'}`,
    `Output kind: ${run.input.outputKind ?? 'image'}`,
    `Operation: ${run.input.operation ?? 'generation'}`,
    `Aspect ratio: ${run.input.aspectRatio ?? 'not specified'}`,
    run.input.durationSeconds ? `Duration seconds: ${run.input.durationSeconds}` : '',
    run.input.variantCount ? `Variants: ${run.input.variantCount}` : '',
    run.input.stylePreset ? `Style preset: ${run.input.stylePreset}` : '',
    run.input.cameraMotion ? `Camera motion: ${run.input.cameraMotion}` : '',
    run.input.negativePrompt ? `Negative prompt: ${run.input.negativePrompt}` : '',
    '',
    'Source media:',
    sourceLines,
    '',
    manifest?.cli?.display ? `Preferred Higgsfield command:\n${manifest.cli.display}` : '',
    '',
    'After dispatch, return or record the Higgsfield job id so the Creative Canvas provider drain can poll it.',
    input.callback?.url ? `When output is ready, callback endpoint: ${input.callback.url}` : '',
    input.callback?.secretConfigured ? 'The callback secret is configured server-side; do not expose it in output.' : '',
    'Do not publish, schedule, share, launch ads, or expose generated assets to clients. Outputs must remain internal until review gates pass.',
  ].filter(Boolean).join('\n')
}

function normalizeHermesStatus(value: unknown): CreativeCanvasRunStatus {
  const status = cleanString(value)?.toLowerCase()
  if (status === 'completed' || status === 'complete' || status === 'done' || status === 'succeeded') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (status === 'waiting_for_review' || status === 'needs_review') return 'waiting_for_review'
  return 'running'
}

function normalizeOutputKind(value: unknown): CreativeCanvasOutputKind | undefined {
  const allowed: CreativeCanvasOutputKind[] = ['image', 'video', 'audio', 'caption', 'copy', 'blog_draft', 'document_block', 'book_artifact', 'youtube_render', 'campaign_asset', 'social_post_draft']
  return allowed.includes(value as CreativeCanvasOutputKind) ? value as CreativeCanvasOutputKind : undefined
}

function inferOutputKindFromUrl(url: string | undefined): CreativeCanvasOutputKind | undefined {
  if (!url) return undefined
  const clean = url.split('?')[0]?.toLowerCase() ?? ''
  if (/\.(mp4|mov|webm|m4v)$/.test(clean)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(clean)) return 'audio'
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(clean)) return 'image'
  return undefined
}

function extractFirstUrlFromText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value : undefined
  if (!text) return undefined
  const match = text.match(/https?:\/\/[^\s)\]'"<>]+/i)
  return match?.[0]
}

function collectTextPreview(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value == null) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  if (Array.isArray(value)) {
    return value.map((item) => collectTextPreview(item, depth + 1)).filter(Boolean).join('\n').trim() || undefined
  }
  const record = asRecord(value)
  if (!record) return undefined
  for (const key of ['textPreview', 'output_text', 'outputText', 'text', 'content', 'markdown', 'message', 'summary', 'caption', 'body', 'output', 'stdout']) {
    const candidate = collectTextPreview(record[key], depth + 1)
    if (candidate) return candidate
  }
  return undefined
}

type RuntimeMediaCandidate = {
  url?: string
  thumbnailUrl?: string
  artifactId?: string
  storagePath?: string
  textPreview?: string
  kind?: CreativeCanvasOutputKind
}

function mediaCandidateFromRecord(record: Record<string, unknown>): RuntimeMediaCandidate | null {
  const url = cleanString(record.url)
    ?? cleanString(record.src)
    ?? cleanString(record.imageUrl)
    ?? cleanString(record.image_url)
    ?? cleanString(record.videoUrl)
    ?? cleanString(record.video_url)
    ?? cleanString(record.audioUrl)
    ?? cleanString(record.audio_url)
    ?? extractFirstUrlFromText(record.output)
    ?? extractFirstUrlFromText(record.stdout)
    ?? extractFirstUrlFromText(record.content)
    ?? extractFirstUrlFromText(record.markdown)
  const storagePath = cleanString(record.storagePath) ?? cleanString(record.storage_path)
  const artifactId = cleanString(record.artifactId) ?? cleanString(record.artifact_id) ?? cleanString(record.id)
  const textPreview = collectTextPreview(record)
  if (!url && !storagePath && !artifactId && !textPreview) return null
  return {
    url,
    thumbnailUrl: cleanString(record.thumbnailUrl) ?? cleanString(record.thumbnail_url) ?? cleanString(record.posterUrl) ?? cleanString(record.poster_url),
    artifactId,
    storagePath,
    textPreview,
    kind: normalizeOutputKind(record.kind ?? record.type ?? record.mimeType) ?? inferOutputKindFromUrl(url),
  }
}

function collectMediaCandidates(value: unknown, candidates: RuntimeMediaCandidate[] = [], depth = 0): RuntimeMediaCandidate[] {
  if (depth > 6 || value == null) return candidates
  if (typeof value === 'string') {
    const url = extractFirstUrlFromText(value)
    if (url) candidates.push({ url, kind: inferOutputKindFromUrl(url), textPreview: value })
    return candidates
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectMediaCandidates(item, candidates, depth + 1))
    return candidates
  }
  const record = asRecord(value)
  if (!record) return candidates

  const direct = mediaCandidateFromRecord(record)
  if (direct) candidates.push(direct)

  for (const key of ['output', 'result', 'response', 'data', 'artifact', 'artifacts', 'asset', 'assets', 'file', 'files', 'media', 'images', 'videos', 'audios', 'richParts', 'rich_parts', 'parts', 'messages']) {
    if (key in record) collectMediaCandidates(record[key], candidates, depth + 1)
  }
  return candidates
}

function bestRuntimeMediaCandidate(body: Record<string, unknown>): RuntimeMediaCandidate {
  return collectMediaCandidates(body).find((candidate) =>
    candidate.url || candidate.storagePath || candidate.artifactId || candidate.textPreview
  ) ?? {}
}

function normalizeHermesOutput(body: Record<string, unknown>) {
  const output = asRecord(body.output)
  const result = asRecord(body.result)
  const artifact = asRecord(body.artifact)
  const media = bestRuntimeMediaCandidate(body)
  const directUrl = cleanString(output.url) ?? cleanString(result.url) ?? cleanString(artifact.url) ?? cleanString(body.url) ?? cleanString(body.imageUrl) ?? cleanString(body.videoUrl)
  return {
    kind: normalizeOutputKind(output.kind ?? result.kind ?? artifact.kind) ?? media.kind ?? inferOutputKindFromUrl(directUrl),
    url: directUrl ?? media.url,
    thumbnailUrl: cleanString(output.thumbnailUrl) ?? cleanString(result.thumbnailUrl) ?? cleanString(artifact.thumbnailUrl) ?? media.thumbnailUrl,
    artifactId: cleanString(output.artifactId) ?? cleanString(result.artifactId) ?? cleanString(artifact.id) ?? media.artifactId,
    storagePath: cleanString(output.storagePath) ?? cleanString(result.storagePath) ?? cleanString(artifact.storagePath) ?? media.storagePath,
    textPreview: cleanString(output.textPreview) ?? cleanString(result.textPreview) ?? cleanString(body.output_text) ?? cleanString(body.outputText) ?? media.textPreview,
  }
}

export async function submitCreativeCanvasRunToHermes(input: CreativeCanvasHermesRuntimeRequest): Promise<{
  providerJobId: string
  providerStatusUrl: string
  providerRequestId?: string
  status: 'running'
  providerStatus: 'hermes_run_submitted'
  providerStatusMessage: string
}> {
  const run = parseRun(input.run)
  if (!run) throw new Error('Valid Higgsfield Creative Canvas run is required')
  const link = await getHermesProfileLink(run.orgId)
  if (!link) throw new Error('Hermes profile link not found for Creative Canvas organisation')
  if (!link.enabled) throw new Error('Hermes profile link is disabled for Creative Canvas organisation')
  if (!link.capabilities.runs) throw new Error('Hermes runs capability is disabled for Creative Canvas organisation')

  const prompt = buildRuntimePrompt({ ...input, run })
  const result = await createHermesRun(link, 'creative-canvas-runtime', {
    prompt,
    metadata: {
      source: 'creative_canvas_higgsfield_runtime',
      orgId: run.orgId,
      canvasId: run.canvasId,
      runId: run.id,
      providerKey: 'higgsfield',
      model: run.model,
      outputKind: run.input.outputKind,
    },
  })
  if (!result.response.ok) {
    const message = result.data && typeof result.data === 'object'
      ? cleanString((result.data as Record<string, unknown>).error) ?? cleanString((result.data as Record<string, unknown>).message)
      : undefined
    throw new Error(message ?? `Hermes run request failed with ${result.response.status}`)
  }

  const body = asRecord(result.data)
  const hermesRunId = cleanString(body.run_id) ?? cleanString(body.runId) ?? cleanString(body.id)
  if (!hermesRunId) throw new Error('Hermes did not return a run id for Creative Canvas runtime dispatch')
  return {
    providerJobId: hermesRunId,
    providerRequestId: result.runDocId ?? undefined,
    providerStatusUrl: `/api/internal/creative-canvas/higgsfield-runtime/runs/${encodeURIComponent(hermesRunId)}?orgId=${encodeURIComponent(run.orgId)}`,
    status: 'running',
    providerStatus: 'hermes_run_submitted',
    providerStatusMessage: `Submitted Creative Canvas Higgsfield run to Hermes profile ${link.profile}.`,
  }
}

export async function getCreativeCanvasHermesRunStatus(orgId: string, runId: string) {
  const cleanOrgId = cleanString(orgId)
  const cleanRunId = cleanString(runId)
  if (!cleanOrgId || !cleanRunId) throw new Error('orgId and runId are required')
  const link = await getHermesProfileLink(cleanOrgId)
  if (!link) throw new Error('Hermes profile link not found for Creative Canvas organisation')
  if (!link.enabled) throw new Error('Hermes profile link is disabled for Creative Canvas organisation')
  if (!link.capabilities.runs) throw new Error('Hermes runs capability is disabled for Creative Canvas organisation')

  const { response, data } = await callHermesJson(link, `/v1/runs/${encodeURIComponent(cleanRunId)}`, { method: 'GET' })
  if (!response.ok) {
    const body = asRecord(data)
    throw new Error(cleanString(body.error) ?? cleanString(body.message) ?? `Hermes run status request failed with ${response.status}`)
  }

  const body = asRecord(data)
  const status = normalizeHermesStatus(body.status ?? body.state)
  const error = asRecord(body.error)
  return {
    providerJobId: cleanRunId,
    status,
    providerStatus: cleanString(body.status) ?? cleanString(body.state) ?? status,
    providerStatusMessage: cleanString(body.message)
      ?? cleanString(body.summary)
      ?? cleanString(error.message)
      ?? `Hermes run ${cleanRunId} is ${status}.`,
    ...(status === 'failed'
      ? {
          error: {
            code: cleanString(error.code) ?? 'hermes_run_failed',
            message: cleanString(error.message) ?? cleanString(body.message) ?? 'Hermes run failed',
            retryable: error.retryable !== false,
          },
        }
      : {}),
    ...(status === 'completed' ? { output: normalizeHermesOutput(body) } : {}),
    raw: data,
  }
}
