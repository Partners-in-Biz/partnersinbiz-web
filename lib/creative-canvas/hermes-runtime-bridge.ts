import { createHash, timingSafeEqual } from 'crypto'
import { createHermesRun, getHermesProfileLink } from '@/lib/hermes/server'
import type { HiggsfieldExecutionManifest } from './higgsfield-execution'
import type { CreativeCanvas, CreativeCanvasRun } from './types'

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
    providerStatusUrl: `/api/v1/admin/hermes/profiles/${encodeURIComponent(run.orgId)}/runs/${encodeURIComponent(hermesRunId)}`,
    status: 'running',
    providerStatus: 'hermes_run_submitted',
    providerStatusMessage: `Submitted Creative Canvas Higgsfield run to Hermes profile ${link.profile}.`,
  }
}
