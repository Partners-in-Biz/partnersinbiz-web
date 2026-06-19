import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getCreativeCanvasProvider } from './providers'
import type {
  CreativeCanvasActor,
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

function cleanAgentId(actor: CreativeCanvasActor): string | undefined {
  if (actor.type !== 'agent') return undefined
  return actor.uid.replace(/^agent:/, '') || undefined
}

function serializeRun(id: string, data: CreativeCanvasRun): CreativeCanvasRun & { id: string } {
  return { id, ...data }
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
      durationSeconds: typeof runInput.durationSeconds === 'number' && Number.isFinite(runInput.durationSeconds)
        ? Math.max(0, runInput.durationSeconds)
        : undefined,
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
