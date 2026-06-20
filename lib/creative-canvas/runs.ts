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
  CreativeCanvasEditMotionMode,
  CreativeCanvasEditOperation,
  CreativeCanvasNode,
  CreativeCanvasOutputKind,
  CreativeCanvasProviderKey,
  CreativeCanvasRun,
  CreativeCanvasRunStatus,
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

function optionalCameraMotion(value: unknown): CreativeCanvasEditMotionMode | undefined {
  const allowed: CreativeCanvasEditMotionMode[] = ['none', 'camera_push', 'camera_pull', 'pan', 'orbit', 'dolly', 'handheld']
  return allowed.includes(value as CreativeCanvasEditMotionMode) ? value as CreativeCanvasEditMotionMode : undefined
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
      artifactId: cleanString(input.output.artifactId),
      url: safeHttpUrl(input.output.url, 'run output.url'),
      thumbnailUrl: safeHttpUrl(input.output.thumbnailUrl, 'run output.thumbnailUrl'),
      storagePath: cleanString(input.output.storagePath),
      textPreview: cleanString(input.output.textPreview),
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
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
  const completedRun: CreativeCanvasRun & { id: string } = {
    ...run,
    status: 'completed',
    output: {
      outputNodeId,
      artifactId: cleanString(output.artifactId),
      url: safeHttpUrl(output.url, 'run output.url'),
      thumbnailUrl: safeHttpUrl(output.thumbnailUrl, 'run output.thumbnailUrl'),
      textPreview: cleanString(output.textPreview),
      rawProviderJobId: cleanString(output.rawProviderJobId),
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
    providerRequestId: cleanString(body.providerRequestId) ?? run.provenance.providerRequestId,
    providerStatusUrl: providerStatusUrl ?? run.provenance.providerStatusUrl,
    providerCallbackUrl: providerCallbackUrl ?? run.provenance.providerCallbackUrl,
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
