import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getCreativeCanvasProvider } from './providers'
import {
  CREATIVE_CANVAS_COLLECTION,
  getCreativeCanvas,
} from './store'
import type {
  CreativeCanvas,
  CreativeCanvasActor,
  CreativeCanvasEditIntent,
  CreativeCanvasEditMask,
  CreativeCanvasMaskBrushStroke,
  CreativeCanvasEditMotionMode,
  CreativeCanvasEditOperation,
  CreativeCanvasNode,
  CreativeCanvasOutputKind,
  CreativeCanvasProofBatchResult,
  CreativeCanvasProviderKey,
  CreativeCanvasRunBatchRetryResult,
  CreativeCanvasRun,
  CreativeCanvasRunOperationsSummary,
  CreativeCanvasRunStatus,
  CreativeCanvasRunStatusCounts,
} from './types'

export const CREATIVE_CANVAS_RUN_COLLECTION = 'creative_canvas_runs'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredString(value: unknown, field: string): string {
  const clean = cleanString(value)
  if (!clean) throw new Error(`${field} is required`)
  return clean
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(cleanString).filter((entry): entry is string => Boolean(entry))))
    : []
}

function cleanOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cleanBoundedOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  const clean = cleanOptionalNumber(value)
  if (clean === undefined) return undefined
  return Math.min(max, Math.max(min, clean))
}

function cleanHttpUrl(value: unknown): string | undefined {
  const raw = cleanString(value)
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    if (parsed.username || parsed.password) throw new Error()
    return parsed.href
  } catch {
    return undefined
  }
}

function cleanRunEditMask(value: unknown): CreativeCanvasEditMask | undefined {
  const mask = asRecord(value)
  if (!Object.keys(mask).length) return undefined
  const region = asRecord(mask.region)
  const regionUnit = region.unit === 'pixel' ? 'pixel' : 'percent'
  const editMask: CreativeCanvasEditMask = {
    sourceNodeId: cleanString(mask.sourceNodeId),
    url: cleanHttpUrl(mask.url),
    storagePath: cleanString(mask.storagePath),
    invert: typeof mask.invert === 'boolean' ? mask.invert : undefined,
  }
  if (Object.keys(region).length) {
    const x = cleanBoundedOptionalNumber(region.x, 0, regionUnit === 'percent' ? 100 : 10000)
    const y = cleanBoundedOptionalNumber(region.y, 0, regionUnit === 'percent' ? 100 : 10000)
    const width = cleanBoundedOptionalNumber(region.width, 0, regionUnit === 'percent' ? 100 : 10000)
    const height = cleanBoundedOptionalNumber(region.height, 0, regionUnit === 'percent' ? 100 : 10000)
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      editMask.region = {
        x,
        y,
        width,
        height,
        unit: regionUnit,
        feather: cleanBoundedOptionalNumber(region.feather, 0, 100),
      }
    }
  }
  const brush = asRecord(mask.brush)
  if (Array.isArray(brush.strokes)) {
    const strokes = brush.strokes.slice(0, 80).map((stroke) => {
      const rawStroke = asRecord(stroke)
      const unit = rawStroke.unit === 'pixel' ? 'pixel' : 'percent'
      const maxCoordinate = unit === 'percent' ? 100 : 10000
      const points = Array.isArray(rawStroke.points)
        ? rawStroke.points.slice(0, 300).map((point) => {
          const rawPoint = asRecord(point)
          const x = cleanBoundedOptionalNumber(rawPoint.x, 0, maxCoordinate)
          const y = cleanBoundedOptionalNumber(rawPoint.y, 0, maxCoordinate)
          return x !== undefined && y !== undefined ? { x, y } : undefined
        }).filter((point): point is { x: number; y: number } => Boolean(point))
        : []
      if (!points.length) return undefined
      const cleanStroke: CreativeCanvasMaskBrushStroke = {
        id: cleanString(rawStroke.id) ?? `stroke-${points[0].x}-${points[0].y}`,
        points,
        size: cleanBoundedOptionalNumber(rawStroke.size, 1, unit === 'percent' ? 25 : 500) ?? 8,
        mode: rawStroke.mode === 'erase' ? 'erase' as const : 'paint' as const,
        unit,
      }
      const opacity = cleanBoundedOptionalNumber(rawStroke.opacity, 0, 1)
      if (opacity !== undefined) cleanStroke.opacity = opacity
      return cleanStroke
    }).filter((stroke): stroke is CreativeCanvasMaskBrushStroke => Boolean(stroke))
    if (strokes.length) editMask.brush = { strokes }
  }
  return editMask.region || editMask.brush || editMask.url || editMask.sourceNodeId || editMask.storagePath ? editMask : undefined
}

function cleanPositiveInteger(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(1, Math.round(value)))
}

function cleanAgentId(actor: CreativeCanvasActor): string | undefined {
  if (actor.type !== 'agent') return undefined
  return actor.uid.replace(/^agent:/, '') || undefined
}

function serializeRun(id: string, data: CreativeCanvasRun): CreativeCanvasRun & { id: string } {
  return { id, ...data }
}

function enumOutputKind(value: unknown): CreativeCanvasOutputKind {
  const allowed: CreativeCanvasOutputKind[] = ['image', 'video', 'audio', 'caption', 'copy', 'blog_draft', 'document_block', 'book_artifact', 'youtube_render', 'campaign_asset', 'social_post_draft']
  return allowed.includes(value as CreativeCanvasOutputKind) ? value as CreativeCanvasOutputKind : 'image'
}

function optionalOutputKind(value: unknown): CreativeCanvasOutputKind | undefined {
  const allowed: CreativeCanvasOutputKind[] = ['image', 'video', 'audio', 'caption', 'copy', 'blog_draft', 'document_block', 'book_artifact', 'youtube_render', 'campaign_asset', 'social_post_draft']
  return allowed.includes(value as CreativeCanvasOutputKind) ? value as CreativeCanvasOutputKind : undefined
}

function optionalEditOperation(value: unknown): CreativeCanvasEditOperation | undefined {
  const allowed: CreativeCanvasEditOperation[] = ['inpaint', 'outpaint', 'style_transfer', 'object_replace', 'background_replace', 'video_motion', 'variation', 'upscale']
  return allowed.includes(value as CreativeCanvasEditOperation) ? value as CreativeCanvasEditOperation : undefined
}

function optionalEditIntent(value: unknown): CreativeCanvasEditIntent | undefined {
  const allowed: CreativeCanvasEditIntent[] = ['generative_fill', 'object_removal', 'object_replace', 'relight', 'reference_blend']
  return allowed.includes(value as CreativeCanvasEditIntent) ? value as CreativeCanvasEditIntent : undefined
}

function optionalCameraMotion(value: unknown): CreativeCanvasEditMotionMode | undefined {
  const allowed: CreativeCanvasEditMotionMode[] = ['none', 'camera_push', 'camera_pull', 'pan', 'orbit', 'dolly', 'handheld']
  return allowed.includes(value as CreativeCanvasEditMotionMode) ? value as CreativeCanvasEditMotionMode : undefined
}

function cleanBlendControls(value: unknown): NonNullable<NonNullable<CreativeCanvasNode['edit']>['blendControls']> | undefined {
  const controls = asRecord(value)
  if (!Object.keys(controls).length) return undefined
  return {
    lightMatch: controls.lightMatch === true,
    textureAdaptive: controls.textureAdaptive === true,
    autoShadows: controls.autoShadows === true,
    perspectiveMatch: controls.perspectiveMatch === true,
    preserveSubject: controls.preserveSubject === true,
  }
}

function optionalRunStatus(value: unknown): CreativeCanvasRunStatus | undefined {
  const allowed: CreativeCanvasRunStatus[] = ['queued', 'running', 'waiting_for_review', 'completed', 'failed', 'cancelled']
  return allowed.includes(value as CreativeCanvasRunStatus) ? value as CreativeCanvasRunStatus : undefined
}

const RUN_STATUSES: CreativeCanvasRunStatus[] = ['queued', 'running', 'waiting_for_review', 'completed', 'failed', 'cancelled']
const DEFAULT_STALE_ACTIVE_MINUTES = 30

type CreativeCanvasProofBatchCategory = 'image' | 'video_social' | 'audio' | 'blog_document' | 'book'
const PROOF_BATCH_RUNS_PER_CATEGORY = 2

interface CreativeCanvasProofBatchSpec {
  category: CreativeCanvasProofBatchCategory
  providerKey: CreativeCanvasProviderKey
  model?: string
  outputKind: CreativeCanvasOutputKind
  operation?: CreativeCanvasEditOperation
  aspectRatio: string
  durationSeconds?: number
  variantCount: number
  format: string
  stylePreset?: string
  cameraMotion?: CreativeCanvasEditMotionMode
  promptSummary: string
}

const PROOF_BATCH_SPECS: CreativeCanvasProofBatchSpec[] = [
  {
    category: 'image',
    providerKey: 'higgsfield',
    model: 'nano_banana_flash',
    outputKind: 'image',
    operation: 'variation',
    aspectRatio: '1:1',
    variantCount: 2,
    format: 'runtime_proof_image',
    stylePreset: 'brand_realism',
    promptSummary: 'Runtime proof image job for a reviewable social campaign asset.',
  },
  {
    category: 'video_social',
    providerKey: 'higgsfield',
    model: 'nano_banana_flash',
    outputKind: 'video',
    operation: 'video_motion',
    aspectRatio: '9:16',
    durationSeconds: 6,
    variantCount: 1,
    format: 'runtime_proof_vertical_video',
    stylePreset: 'ugc_social',
    cameraMotion: 'camera_push',
    promptSummary: 'Runtime proof vertical social video job from the active canvas graph.',
  },
  {
    category: 'audio',
    providerKey: 'higgsfield',
    model: 'nano_banana_flash',
    outputKind: 'audio',
    operation: 'variation',
    aspectRatio: '1:1',
    durationSeconds: 15,
    variantCount: 1,
    format: 'runtime_proof_audio',
    stylePreset: 'brand_audio',
    promptSummary: 'Runtime proof audio job for voiceover, sound bed, or social media audio assets.',
  },
  {
    category: 'blog_document',
    providerKey: 'agent_task',
    outputKind: 'blog_draft',
    aspectRatio: '4:5',
    variantCount: 1,
    format: 'runtime_proof_blog_document',
    promptSummary: 'Runtime proof blog/document draft job from the active canvas graph.',
  },
  {
    category: 'book',
    providerKey: 'higgsfield',
    model: 'nano_banana_flash',
    outputKind: 'book_artifact',
    operation: 'variation',
    aspectRatio: '4:5',
    variantCount: 1,
    format: 'runtime_proof_book_artifact',
    stylePreset: 'editorial',
    promptSummary: 'Runtime proof book artifact job for cover or chapter creative assets.',
  },
]

function emptyStatusCounts(): CreativeCanvasRunStatusCounts {
  return {
    queued: 0,
    running: 0,
    waiting_for_review: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  }
}

function isActiveRunStatus(status: CreativeCanvasRunStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting_for_review'
}

function runMatchesProofCategory(run: CreativeCanvasRun, category: CreativeCanvasProofBatchCategory): boolean {
  const outputKind = run.input.outputKind
  if (category === 'image') return outputKind === 'image' || outputKind === 'campaign_asset'
  if (category === 'video_social') return outputKind === 'video' || outputKind === 'social_post_draft' || outputKind === 'youtube_render'
  if (category === 'audio') return outputKind === 'audio'
  if (category === 'blog_document') return outputKind === 'blog_draft' || outputKind === 'document_block' || outputKind === 'copy' || outputKind === 'caption'
  return outputKind === 'book_artifact'
}

function bestProofBatchNode(canvas: CreativeCanvas & { id: string }, spec: CreativeCanvasProofBatchSpec): CreativeCanvasNode | undefined {
  const matchingOutput = canvas.nodes.find((node) => node.output?.kind === spec.outputKind)
  if (matchingOutput) return matchingOutput

  const matchingEdit = canvas.nodes.find((node) => node.edit?.outputKind === spec.outputKind)
  if (matchingEdit) return matchingEdit

  const matchingProvider = canvas.nodes.find((node) => node.provider?.key === spec.providerKey)
  if (matchingProvider) return matchingProvider

  return canvas.nodes.find((node) => ['model', 'edit', 'prompt', 'source', 'brief'].includes(node.type))
}

function sourceNodeIdsForProofBatch(canvas: CreativeCanvas & { id: string }, sourceNode: CreativeCanvasNode): string[] {
  const linkedSourceIds = canvas.edges
    .filter((edge) => edge.targetNodeId === sourceNode.id)
    .map((edge) => edge.sourceNodeId)
    .filter((nodeId) => canvas.nodes.some((node) => node.id === nodeId))

  return Array.from(new Set([sourceNode.id, ...linkedSourceIds])).slice(0, 8)
}

function timestampToMillis(value: unknown): number | undefined {
  if (!value) return undefined
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const record = asRecord(value)
  if (typeof record.toMillis === 'function') {
    const millis = record.toMillis()
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : undefined
  }
  if (typeof record.toDate === 'function') {
    const date = record.toDate()
    return date instanceof Date ? date.getTime() : undefined
  }
  const seconds = typeof record.seconds === 'number'
    ? record.seconds
    : typeof record._seconds === 'number'
      ? record._seconds
      : undefined
  if (seconds !== undefined) {
    const nanos = typeof record.nanoseconds === 'number'
      ? record.nanoseconds
      : typeof record._nanoseconds === 'number'
        ? record._nanoseconds
        : 0
    return seconds * 1000 + Math.floor(nanos / 1_000_000)
  }
  return undefined
}

function activeRunAgeMinutes(run: CreativeCanvasRun, nowMs: number): number | undefined {
  const updatedMs = timestampToMillis(run.updatedAt) ?? timestampToMillis(run.createdAt)
  if (updatedMs === undefined) return undefined
  return Math.max(0, Math.floor((nowMs - updatedMs) / 60_000))
}

function buildRetriedCreativeCanvasProviderRun(run: CreativeCanvasRun & { id: string }): CreativeCanvasRun & { id: string } {
  const provenance = { ...run.provenance }
  delete provenance.providerJobId
  delete provenance.providerRequestId
  delete provenance.providerStatusUrl
  delete provenance.providerCallbackUrl

  return {
    ...run,
    status: 'queued',
    providerStatus: 'retry_queued',
    providerStatusMessage: 'Retry queued for provider runtime drain.',
    error: undefined,
    provenance,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

function retryRunUpdatePayload(run: CreativeCanvasRun & { id: string }, actor: CreativeCanvasActor) {
  return {
    status: run.status,
    providerStatus: run.providerStatus,
    providerStatusMessage: run.providerStatusMessage,
    error: null,
    provenance: run.provenance,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedByType: actor.type,
  }
}

export function summarizeCreativeCanvasRuns(
  runs: Array<CreativeCanvasRun & { id: string }>,
  options: { now?: Date; staleAfterMinutes?: number } = {},
): CreativeCanvasRunOperationsSummary {
  const byStatus = emptyStatusCounts()
  const providerMap = new Map<CreativeCanvasProviderKey, CreativeCanvasRunOperationsSummary['providers'][number]>()
  const nowMs = options.now?.getTime() ?? Date.now()
  const staleThresholdMinutes = Math.max(1, options.staleAfterMinutes ?? DEFAULT_STALE_ACTIVE_MINUTES)
  let staleActiveRuns = 0
  let oldestActiveRunAgeMinutes: number | undefined

  for (const run of runs) {
    const status = RUN_STATUSES.includes(run.status) ? run.status : 'queued'
    byStatus[status] += 1

    const provider = providerMap.get(run.providerKey) ?? {
      providerKey: run.providerKey,
      total: 0,
      byStatus: emptyStatusCounts(),
      active: 0,
      staleActiveRuns: 0,
      failed: 0,
      retryableFailures: 0,
      completed: 0,
    }
    provider.total += 1
    provider.byStatus[status] += 1
    if (isActiveRunStatus(status)) {
      provider.active += 1
      const ageMinutes = activeRunAgeMinutes(run, nowMs)
      if (ageMinutes !== undefined) {
        provider.oldestActiveRunAgeMinutes = Math.max(provider.oldestActiveRunAgeMinutes ?? 0, ageMinutes)
        oldestActiveRunAgeMinutes = Math.max(oldestActiveRunAgeMinutes ?? 0, ageMinutes)
        if (ageMinutes >= staleThresholdMinutes) {
          provider.staleActiveRuns += 1
          staleActiveRuns += 1
        }
      }
    }
    if (status === 'failed') provider.failed += 1
    if (status === 'completed') provider.completed += 1
    if (run.error?.retryable) provider.retryableFailures += 1
    if (!provider.latestRunId) provider.latestRunId = run.id
    if (!provider.latestProviderStatus && run.providerStatus) provider.latestProviderStatus = run.providerStatus
    if (!provider.latestProviderStatusMessage && run.providerStatusMessage) provider.latestProviderStatusMessage = run.providerStatusMessage
    if (!provider.latestErrorMessage && run.error?.message) provider.latestErrorMessage = run.error.message
    providerMap.set(run.providerKey, provider)
  }

  const providers = Array.from(providerMap.values()).sort((a, b) => {
    if (b.active !== a.active) return b.active - a.active
    if (b.failed !== a.failed) return b.failed - a.failed
    return a.providerKey.localeCompare(b.providerKey)
  })

  return {
    total: runs.length,
    byStatus,
    active: byStatus.queued + byStatus.running + byStatus.waiting_for_review,
    staleActiveRuns,
    oldestActiveRunAgeMinutes,
    staleThresholdMinutes,
    failed: byStatus.failed,
    retryableFailures: runs.filter((run) => run.error?.retryable).length,
    completed: byStatus.completed,
    providers,
  }
}

function safeHttpUrl(value: unknown, field: string): string | undefined {
  const raw = cleanString(value)
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    if (parsed.username || parsed.password) throw new Error()
    return parsed.href
  } catch {
    throw new Error(`${field} must be a safe http(s) URL`)
  }
}

function buildOutputNode(input: {
  run: CreativeCanvasRun & { id: string }
  canvas: CreativeCanvas & { id: string }
  outputNodeId: string
  output: Record<string, unknown>
}): CreativeCanvasNode {
  const sourceNode = input.canvas.nodes.find((node) => node.id === input.run.nodeId)
  const artifactId = cleanString(input.output.artifactId)
  const url = safeHttpUrl(input.output.url, 'run output.url')
  const thumbnailUrl = safeHttpUrl(input.output.thumbnailUrl, 'run output.thumbnailUrl')
  const storagePath = cleanString(input.output.storagePath)
  const textPreview = cleanString(input.output.textPreview)
  const now = new Date()
  return {
    id: input.outputNodeId,
    canvasId: input.canvas.id,
    orgId: input.canvas.orgId,
    type: 'output',
    title: cleanString(input.output.title) ?? `${input.run.providerKey} output`,
    position: {
      x: (sourceNode?.position.x ?? 0) + 320,
      y: sourceNode?.position.y ?? 0,
    },
    data: {
      sourceRunId: input.run.id,
      sourceProviderKey: input.run.providerKey,
      sourceModel: input.run.model,
    },
    review: {
      status: 'needed',
      syntheticMediaDisclosure: input.run.provenance.syntheticMedia,
      rightsStatus: 'needs_review',
      brandStatus: 'needs_review',
    },
    output: {
      kind: enumOutputKind(input.output.kind),
      ...(artifactId ? { artifactId } : {}),
      ...(url ? { url } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(storagePath ? { storagePath } : {}),
      ...(textPreview ? { textPreview } : {}),
    },
    createdAt: now,
    updatedAt: now,
  }
}

function upsertOutputNode(canvas: CreativeCanvas & { id: string }, outputNode: CreativeCanvasNode): CreativeCanvasNode[] {
  const existing = canvas.nodes.some((node) => node.id === outputNode.id)
  if (!existing) return [...canvas.nodes, outputNode]
  return canvas.nodes.map((node) => node.id === outputNode.id ? { ...node, ...outputNode } : node)
}

function upsertOutputEdge(canvas: CreativeCanvas & { id: string }, run: CreativeCanvasRun, outputNodeId: string) {
  const edgeId = `${run.nodeId}-${outputNodeId}`
  const existing = canvas.edges.some((edge) => edge.id === edgeId)
  if (existing) return canvas.edges
  return [
    ...canvas.edges,
    {
      id: edgeId,
      canvasId: canvas.id,
      orgId: canvas.orgId,
      sourceNodeId: run.nodeId,
      targetNodeId: outputNodeId,
      label: 'generated output',
      data: { sourceRunId: run.id },
    },
  ]
}

async function completeLoadedCreativeCanvasRun(
  run: CreativeCanvasRun & { id: string },
  orgId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<{ run: CreativeCanvasRun & { id: string }; outputNode?: CreativeCanvasNode }> {
  const body = asRecord(input)
  const output = asRecord(body.output)
  const provenancePatch = asRecord(body.provenance)

  if (run.orgId !== orgId) throw new Error('Creative canvas run does not belong to organisation')

  const canvas = await getCreativeCanvas(run.canvasId, orgId)
  if (!canvas) throw new Error('Creative canvas not found')

  const outputNodeId = cleanString(body.outputNodeId) ?? `${run.nodeId}-output`
  const outputNode = buildOutputNode({ run, canvas, outputNodeId, output })
  const artifactId = cleanString(output.artifactId)
  const url = safeHttpUrl(output.url, 'run output.url')
  const thumbnailUrl = safeHttpUrl(output.thumbnailUrl, 'run output.thumbnailUrl')
  const textPreview = cleanString(output.textPreview)
  const rawProviderJobId = cleanString(output.rawProviderJobId)
  const completedRun: CreativeCanvasRun & { id: string } = {
    ...run,
    status: 'completed',
    output: {
      outputNodeId,
      ...(artifactId ? { artifactId } : {}),
      ...(url ? { url } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(textPreview ? { textPreview } : {}),
      ...(rawProviderJobId ? { rawProviderJobId } : {}),
    },
    provenance: {
      ...run.provenance,
      providerJobId: cleanString(provenancePatch.providerJobId) ?? run.provenance.providerJobId,
      model: cleanString(provenancePatch.model) ?? run.provenance.model,
      costUnits: typeof provenancePatch.costUnits === 'number' && Number.isFinite(provenancePatch.costUnits)
        ? provenancePatch.costUnits
        : run.provenance.costUnits,
      costLabel: cleanString(provenancePatch.costLabel) ?? run.provenance.costLabel,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }

  await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(run.id).update({
    status: completedRun.status,
    output: completedRun.output,
    provenance: completedRun.provenance,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedByType: actor.type,
  })

  const nextNodes = upsertOutputNode(canvas, outputNode)
  const nextEdges = upsertOutputEdge(canvas, run, outputNodeId)
  await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(canvas.id).update({
    nodes: nextNodes,
    edges: nextEdges,
    activeVersion: canvas.activeVersion + 1,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedByType: actor.type,
  })

  return { run: completedRun, outputNode }
}

export async function createCreativeCanvasRun(
  input: unknown,
  orgId: string,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvasRun & { id: string }> {
  const body = asRecord(input)
  const runInput = asRecord(body.input)
  const provenance = asRecord(body.provenance)
  const providerKey = requiredString(body.providerKey, 'providerKey') as CreativeCanvasProviderKey
  const provider = getCreativeCanvasProvider(providerKey)
  if (!provider) throw new Error(`Unsupported creative canvas provider: ${providerKey}`)

  const model = cleanString(body.model)
  const durationSeconds = cleanOptionalNumber(runInput.durationSeconds)
  const payload: CreativeCanvasRun = {
    orgId: requiredString(orgId, 'orgId'),
    canvasId: requiredString(body.canvasId, 'canvasId'),
    nodeId: requiredString(body.nodeId, 'nodeId'),
    providerKey,
    model,
    status: 'queued' as CreativeCanvasRunStatus,
    input: {
      promptSummary: cleanString(runInput.promptSummary),
      sourceNodeIds: cleanStringArray(runInput.sourceNodeIds),
      sourceArtifactIds: cleanStringArray(runInput.sourceArtifactIds),
      format: cleanString(runInput.format),
      aspectRatio: cleanString(runInput.aspectRatio),
      durationSeconds: durationSeconds !== undefined
        ? Math.max(0, durationSeconds)
        : undefined,
      outputKind: optionalOutputKind(runInput.outputKind),
      operation: optionalEditOperation(runInput.operation),
      variantCount: cleanPositiveInteger(runInput.variantCount, 8),
      seed: cleanString(runInput.seed),
      stylePreset: cleanString(runInput.stylePreset),
      cameraMotion: optionalCameraMotion(runInput.cameraMotion),
      negativePrompt: cleanString(runInput.negativePrompt),
      editMask: cleanRunEditMask(runInput.editMask),
      editIntent: optionalEditIntent(runInput.editIntent),
      blendControls: cleanBlendControls(runInput.blendControls),
    },
    provenance: {
      generatedBy: actor.type,
      agentId: cleanAgentId(actor),
      model,
      costLabel: provider.usesExternalCredits ? 'external_credits' : undefined,
      promptStored: cleanString(runInput.promptSummary) ? 'summary' : 'none',
      syntheticMedia: provenance.syntheticMedia === true || providerKey === 'higgsfield' || providerKey === 'xai',
    },
  }

  const ref = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return serializeRun(ref.id, payload)
}

export async function listCreativeCanvasRuns(
  canvasId: string,
  orgId: string,
): Promise<Array<CreativeCanvasRun & { id: string }>> {
  const snapshot = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION)
    .where('canvasId', '==', requiredString(canvasId, 'canvasId'))
    .where('orgId', '==', requiredString(orgId, 'orgId'))
    .get()

  return snapshot.docs.map((doc) => serializeRun(doc.id, doc.data() as CreativeCanvasRun))
}

export async function completeCreativeCanvasRun(
  runId: string,
  orgId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<{ run: CreativeCanvasRun & { id: string }; outputNode?: CreativeCanvasNode }> {
  const runSnap = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(runId).get()
  if (!runSnap.exists) throw new Error('Creative canvas run not found')
  const run = serializeRun(runSnap.id ?? runId, runSnap.data() as CreativeCanvasRun)
  return completeLoadedCreativeCanvasRun(run, orgId, input, actor)
}

export async function ensureCreativeCanvasRunOutputNode(
  runId: string,
  orgId: string,
  actor: CreativeCanvasActor,
): Promise<{ run: CreativeCanvasRun & { id: string }; outputNode?: CreativeCanvasNode } | null> {
  const runSnap = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(runId).get()
  if (!runSnap.exists) throw new Error('Creative canvas run not found')
  const run = serializeRun(runSnap.id ?? runId, runSnap.data() as CreativeCanvasRun)
  if (run.orgId !== orgId) throw new Error('Creative canvas run does not belong to organisation')
  if (!run.output?.url && !run.output?.artifactId && !run.output?.textPreview) return null

  const outputNodeId = run.output.outputNodeId ?? `${run.nodeId}-output`
  const canvas = await getCreativeCanvas(run.canvasId, orgId)
  const existingOutputNode = canvas?.nodes.find((node) => node.id === outputNodeId)
  if (existingOutputNode) {
    return { run, outputNode: existingOutputNode }
  }

  return completeLoadedCreativeCanvasRun(run, orgId, {
    outputNodeId,
    output: {
      kind: run.input.outputKind ?? 'image',
      url: run.output.url,
      thumbnailUrl: run.output.thumbnailUrl,
      artifactId: run.output.artifactId,
      textPreview: run.output.textPreview,
      rawProviderJobId: run.output.rawProviderJobId,
    },
    provenance: {
      providerJobId: run.output.rawProviderJobId ?? run.provenance.providerJobId,
      model: run.provenance.model,
      costUnits: run.provenance.costUnits,
      costLabel: run.provenance.costLabel,
    },
  }, actor)
}

export async function dispatchCreativeCanvasProviderRun(
  runId: string,
  orgId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvasRun & { id: string }> {
  const body = asRecord(input)
  const providerJobId = requiredString(body.providerJobId, 'providerJobId')
  const runSnap = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(runId).get()
  if (!runSnap.exists) throw new Error('Creative canvas run not found')
  const run = serializeRun(runSnap.id ?? runId, runSnap.data() as CreativeCanvasRun)
  if (run.orgId !== orgId) throw new Error('Creative canvas run does not belong to organisation')
  if (run.status === 'completed' || run.status === 'cancelled') {
    throw new Error('Creative canvas run cannot be dispatched from its current status')
  }

  const providerStatusUrl = safeHttpUrl(body.providerStatusUrl, 'providerStatusUrl')
  const providerCallbackUrl = safeHttpUrl(body.providerCallbackUrl, 'providerCallbackUrl')
  const provenance = {
    ...run.provenance,
    providerJobId,
    ...(cleanString(body.providerRequestId) ?? run.provenance.providerRequestId
      ? { providerRequestId: cleanString(body.providerRequestId) ?? run.provenance.providerRequestId }
      : {}),
    ...(providerStatusUrl ?? run.provenance.providerStatusUrl
      ? { providerStatusUrl: providerStatusUrl ?? run.provenance.providerStatusUrl }
      : {}),
    ...(providerCallbackUrl ?? run.provenance.providerCallbackUrl
      ? { providerCallbackUrl: providerCallbackUrl ?? run.provenance.providerCallbackUrl }
      : {}),
  }
  const nextRun: CreativeCanvasRun & { id: string } = {
    ...run,
    status: 'running',
    provenance,
    updatedAt: FieldValue.serverTimestamp(),
  }

  await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(run.id).update({
    status: nextRun.status,
    provenance,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedByType: actor.type,
  })

  return nextRun
}

export async function refreshCreativeCanvasProviderRunStatus(
  runId: string,
  orgId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvasRun & { id: string }> {
  const body = asRecord(input)
  const status = optionalRunStatus(body.status)
  if (!status || status === 'completed') {
    throw new Error('Provider status refresh must use queued, running, waiting_for_review, failed, or cancelled')
  }

  const runSnap = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(runId).get()
  if (!runSnap.exists) throw new Error('Creative canvas run not found')
  const run = serializeRun(runSnap.id ?? runId, runSnap.data() as CreativeCanvasRun)
  if (run.orgId !== orgId) throw new Error('Creative canvas run does not belong to organisation')

  const error = asRecord(body.error)
  const nextRun: CreativeCanvasRun & { id: string } = {
    ...run,
    status,
    providerStatus: cleanString(body.providerStatus) ?? run.providerStatus,
    providerStatusMessage: cleanString(body.providerStatusMessage) ?? run.providerStatusMessage,
    error: status === 'failed'
      ? {
          code: cleanString(error.code) ?? 'provider_error',
          message: cleanString(error.message) ?? cleanString(body.providerStatusMessage) ?? 'Provider run failed',
          retryable: error.retryable === true,
        }
      : undefined,
    updatedAt: FieldValue.serverTimestamp(),
  }
  const updatePayload = {
    status: nextRun.status,
    providerStatus: nextRun.providerStatus,
    providerStatusMessage: nextRun.providerStatusMessage,
    error: nextRun.error ?? null,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedByType: actor.type,
  }

  await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(run.id).update(updatePayload)

  return nextRun
}

export async function retryCreativeCanvasProviderRun(
  runId: string,
  orgId: string,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvasRun & { id: string }> {
  const runSnap = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(runId).get()
  if (!runSnap.exists) throw new Error('Creative canvas run not found')
  const run = serializeRun(runSnap.id ?? runId, runSnap.data() as CreativeCanvasRun)
  if (run.orgId !== orgId) throw new Error('Creative canvas run does not belong to organisation')
  if (run.status !== 'failed') throw new Error('Only failed creative canvas provider runs can be retried')
  if (run.error?.retryable !== true) throw new Error('Creative canvas provider run is not marked retryable')

  const nextRun = buildRetriedCreativeCanvasProviderRun(run)

  await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(run.id).update(retryRunUpdatePayload(nextRun, actor))

  return nextRun
}

export async function retryCreativeCanvasProviderRunsForCanvas(
  canvasId: string,
  orgId: string,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvasRunBatchRetryResult> {
  const snapshot = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION)
    .where('canvasId', '==', requiredString(canvasId, 'canvasId'))
    .where('orgId', '==', requiredString(orgId, 'orgId'))
    .get()

  const retriedRuns: Array<CreativeCanvasRun & { id: string }> = []
  const skippedRuns: CreativeCanvasRunBatchRetryResult['skippedRuns'] = []
  const nextRuns: Array<CreativeCanvasRun & { id: string }> = []

  for (const doc of snapshot.docs) {
    const run = serializeRun(doc.id, doc.data() as CreativeCanvasRun)
    if (run.status === 'failed' && run.error?.retryable === true) {
      const nextRun = buildRetriedCreativeCanvasProviderRun(run)
      retriedRuns.push(nextRun)
      nextRuns.push(nextRun)
      await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(run.id).update(retryRunUpdatePayload(nextRun, actor))
      continue
    }

    nextRuns.push(run)
    if (run.status === 'failed') {
      skippedRuns.push({
        id: run.id,
        status: run.status,
        reason: run.error?.retryable === true ? 'Retryable run was not selected' : 'Failed run is not retryable',
      })
    }
  }

  return {
    retriedRuns,
    skippedRuns,
    operations: summarizeCreativeCanvasRuns(nextRuns),
  }
}

export async function queueCreativeCanvasProofBatchRuns(
  canvas: CreativeCanvas & { id: string },
  orgId: string,
  actor: CreativeCanvasActor,
  existingRuns: Array<CreativeCanvasRun & { id: string }>,
): Promise<CreativeCanvasProofBatchResult> {
  if (canvas.orgId !== orgId) throw new Error('Creative canvas does not belong to organisation')
  if (!canvas.nodes.length) throw new Error('Creative canvas needs at least one node before queueing proof runs')

  const queuedRuns: Array<CreativeCanvasRun & { id: string }> = []
  const skippedCategories: CreativeCanvasProofBatchResult['skippedCategories'] = []

  for (const spec of PROOF_BATCH_SPECS) {
    const coveredRuns = [...queuedRuns, ...existingRuns].filter((run) =>
      runMatchesProofCategory(run, spec.category) && (run.status === 'completed' || isActiveRunStatus(run.status)))
    const missingRunCount = Math.max(0, PROOF_BATCH_RUNS_PER_CATEGORY - coveredRuns.length)

    if (!missingRunCount) {
      const coveredRun = coveredRuns[0]
      skippedCategories.push({
        category: spec.category,
        reason: coveredRuns.every((run) => run.status === 'completed') ? 'Already has completed proof coverage' : 'Proof runs already active',
        runId: coveredRun?.id,
      })
      continue
    }

    const sourceNode = bestProofBatchNode(canvas, spec)
    if (!sourceNode) {
      skippedCategories.push({
        category: spec.category,
        reason: 'No usable canvas node found for proof run',
      })
      continue
    }

    for (let index = 0; index < missingRunCount; index += 1) {
      const slot = coveredRuns.length + index + 1
      const run = await createCreativeCanvasRun({
        canvasId: canvas.id,
        nodeId: sourceNode.id,
        providerKey: spec.providerKey,
        model: spec.model ?? sourceNode.provider?.model,
        input: {
          promptSummary: `${spec.promptSummary} Reliability pass ${slot}/${PROOF_BATCH_RUNS_PER_CATEGORY}. Canvas: ${canvas.title}.`,
          sourceNodeIds: sourceNodeIdsForProofBatch(canvas, sourceNode),
          sourceArtifactIds: [],
          format: spec.format,
          outputKind: spec.outputKind,
          operation: spec.operation,
          aspectRatio: spec.aspectRatio,
          durationSeconds: spec.durationSeconds,
          variantCount: spec.variantCount,
          seed: `${spec.category}-proof-${slot}`,
          stylePreset: spec.stylePreset,
          cameraMotion: spec.cameraMotion,
          negativePrompt: spec.providerKey === 'higgsfield' ? 'blur, distorted text, off-brand elements, unsafe claims' : undefined,
          editMask: sourceNode.edit?.mask,
        },
        provenance: {
          syntheticMedia: spec.providerKey === 'higgsfield',
        },
      }, orgId, actor)
      queuedRuns.push(run)
    }
  }

  return {
    queuedRuns,
    skippedCategories,
    operations: summarizeCreativeCanvasRuns([...queuedRuns, ...existingRuns]),
  }
}

export async function completeCreativeCanvasProviderCallback(
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<{ run: CreativeCanvasRun & { id: string }; outputNode?: CreativeCanvasNode }> {
  const body = asRecord(input)
  const orgId = requiredString(body.orgId, 'orgId')
  const providerKey = requiredString(body.providerKey, 'providerKey') as CreativeCanvasProviderKey
  const providerJobId = requiredString(body.providerJobId, 'providerJobId')
  const output = {
    ...asRecord(body.output),
    rawProviderJobId: providerJobId,
  }
  const provenance = {
    ...asRecord(body.provenance),
    providerJobId,
  }

  const runQuery = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION)
    .where('providerKey', '==', providerKey)
    .where('provenance.providerJobId', '==', providerJobId)
    .where('orgId', '==', orgId)
    .get()

  const runSnap = runQuery.docs[0]
  if (!runSnap) throw new Error('Creative canvas provider run not found')

  const run = serializeRun(runSnap.id, runSnap.data() as CreativeCanvasRun)
  return completeLoadedCreativeCanvasRun(run, orgId, {
    outputNodeId: cleanString(body.outputNodeId),
    output,
    provenance,
  }, actor)
}
