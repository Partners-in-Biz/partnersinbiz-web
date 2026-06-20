import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { CREATIVE_CANVAS_COLLECTION, CREATIVE_CANVAS_VERSION_COLLECTION, getCreativeCanvas } from './store'
import type {
  CreativeCanvas,
  CreativeCanvasActor,
  CreativeCanvasBrandStatus,
  CreativeCanvasComment,
  CreativeCanvasNode,
  CreativeCanvasOutputKind,
  CreativeCanvasOutputPatch,
  CreativeCanvasReviewPatch,
  CreativeCanvasReviewStatus,
  CreativeCanvasRightsStatus,
  CreativeCanvasVersion,
  CreativeCanvasVisibility,
} from './types'

export const CREATIVE_CANVAS_COMMENT_COLLECTION = 'creative_canvas_comments'

type UnknownRecord = Record<string, unknown>

const VISIBILITIES: CreativeCanvasVisibility[] = ['admin_agents', 'admin_agents_clients']
const OUTPUT_KINDS: CreativeCanvasOutputKind[] = ['image', 'video', 'audio', 'caption', 'copy', 'blog_draft', 'document_block', 'book_artifact', 'youtube_render', 'campaign_asset', 'social_post_draft']
const REVIEW_STATUSES: CreativeCanvasReviewStatus[] = ['not_required', 'needed', 'passed', 'warning', 'blocked']
const RIGHTS_STATUSES: CreativeCanvasRightsStatus[] = ['unknown', 'cleared', 'needs_review', 'blocked']
const BRAND_STATUSES: CreativeCanvasBrandStatus[] = ['unknown', 'passed', 'needs_review', 'blocked']

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredString(value: unknown, field: string): string {
  const clean = cleanString(value)
  if (!clean) throw new Error(`${field} is required`)
  return clean
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
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

function serializeVersion(id: string, data: UnknownRecord): CreativeCanvasVersion & { id: string } {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    canvasId: String(data.canvasId ?? ''),
    version: typeof data.version === 'number' ? data.version : 1,
    nodes: Array.isArray(data.nodes) ? data.nodes as CreativeCanvasNode[] : [],
    edges: Array.isArray(data.edges) ? data.edges as CreativeCanvasVersion['edges'] : [],
    createdAt: data.createdAt,
    createdBy: String(data.createdBy ?? ''),
    createdByType: data.createdByType === 'agent' || data.createdByType === 'system' ? data.createdByType : 'user',
    reason: cleanString(data.reason),
  }
}

function serializeComment(id: string, data: CreativeCanvasComment): CreativeCanvasComment & { id: string } {
  return { id, ...data }
}

function sanitizeReviewPatch(input: unknown, fallback: CreativeCanvasReviewPatch = {}): CreativeCanvasReviewPatch {
  const body = asRecord(input)
  return {
    status: enumValue(body.status, REVIEW_STATUSES, fallback.status ?? 'needed'),
    approvalGateTaskId: cleanString(body.approvalGateTaskId) ?? fallback.approvalGateTaskId,
    requiredReviewerAgentId: cleanString(body.requiredReviewerAgentId) ?? fallback.requiredReviewerAgentId,
    syntheticMediaDisclosure: typeof body.syntheticMediaDisclosure === 'boolean'
      ? body.syntheticMediaDisclosure
      : fallback.syntheticMediaDisclosure,
    rightsStatus: enumValue(body.rightsStatus, RIGHTS_STATUSES, fallback.rightsStatus ?? 'unknown'),
    brandStatus: enumValue(body.brandStatus, BRAND_STATUSES, fallback.brandStatus ?? 'unknown'),
  }
}

function mergeNodeReview(
  current: CreativeCanvasNode['review'],
  patch: CreativeCanvasReviewPatch,
): NonNullable<CreativeCanvasNode['review']> {
  return {
    ...current,
    ...patch,
    status: patch.status ?? current?.status ?? 'needed',
  }
}

function sanitizeOutputPatch(input: unknown): CreativeCanvasOutputPatch {
  const body = asRecord(input)
  return {
    kind: enumValue(body.kind, OUTPUT_KINDS, 'image'),
    artifactId: cleanString(body.artifactId),
    url: safeHttpUrl(body.url, 'output.url'),
    thumbnailUrl: safeHttpUrl(body.thumbnailUrl, 'output.thumbnailUrl'),
    storagePath: cleanString(body.storagePath),
    textPreview: cleanString(body.textPreview),
    review: Object.keys(asRecord(body.review)).length ? sanitizeReviewPatch(body.review) : undefined,
  }
}

function patchNode(
  canvas: CreativeCanvas & { id: string },
  nodeId: string,
  updater: (node: CreativeCanvasNode) => CreativeCanvasNode,
): CreativeCanvasNode[] {
  let found = false
  const nodes = canvas.nodes.map((node) => {
    if (node.id !== nodeId) return node
    found = true
    return updater(node)
  })
  if (!found) throw new Error(`Creative canvas node not found: ${nodeId}`)
  return nodes
}

async function updateCanvasNodes(
  canvas: CreativeCanvas & { id: string },
  nodes: CreativeCanvasNode[],
  actor: CreativeCanvasActor,
): Promise<CreativeCanvas & { id: string }> {
  const patch = {
    nodes,
    updatedBy: actor.uid,
    updatedByType: actor.type,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(canvas.id).update(patch)
  return { ...canvas, ...patch, updatedAt: canvas.updatedAt }
}

export async function listCreativeCanvasVersions(
  canvasId: string,
  orgId: string,
): Promise<Array<CreativeCanvasVersion & { id: string }>> {
  const snap = await adminDb
    .collection(CREATIVE_CANVAS_VERSION_COLLECTION)
    .where('orgId', '==', orgId)
    .where('canvasId', '==', canvasId)
    .get()

  return snap.docs
    .map((doc: { id: string; data: () => UnknownRecord }) => serializeVersion(doc.id, doc.data()))
    .sort((a, b) => b.version - a.version)
}

export async function createCreativeCanvasComment(
  canvasId: string,
  orgId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvasComment & { id: string }> {
  const body = asRecord(input)
  const payload: CreativeCanvasComment = {
    orgId: requiredString(orgId, 'orgId'),
    canvasId: requiredString(canvasId, 'canvasId'),
    nodeId: cleanString(body.nodeId),
    body: requiredString(body.body, 'body'),
    visibility: enumValue(body.visibility, VISIBILITIES, 'admin_agents'),
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: requiredString(actor.uid, 'actor.uid'),
    createdByType: actor.type,
    updatedAt: FieldValue.serverTimestamp(),
  }
  const ref = await adminDb.collection(CREATIVE_CANVAS_COMMENT_COLLECTION).add(payload)
  return serializeComment(ref.id, payload)
}

export async function attachCreativeCanvasNodeOutput(
  canvasId: string,
  orgId: string,
  nodeId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvas & { id: string }> {
  const canvas = await getCreativeCanvas(canvasId, orgId)
  if (!canvas) throw new Error('Creative canvas not found')
  const output = sanitizeOutputPatch(input)
  const nodes = patchNode(canvas, nodeId, (node) => ({
    ...node,
    output: {
      kind: output.kind,
      artifactId: output.artifactId,
      url: output.url,
      thumbnailUrl: output.thumbnailUrl,
      storagePath: output.storagePath,
      textPreview: output.textPreview,
    },
    review: output.review ? mergeNodeReview(node.review, output.review) : node.review,
    updatedAt: FieldValue.serverTimestamp(),
  }))

  return updateCanvasNodes(canvas, nodes, actor)
}

export async function updateCreativeCanvasNodeReview(
  canvasId: string,
  orgId: string,
  nodeId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvas & { id: string }> {
  const canvas = await getCreativeCanvas(canvasId, orgId)
  if (!canvas) throw new Error('Creative canvas not found')
  const review = sanitizeReviewPatch(input)
  const nodes = patchNode(canvas, nodeId, (node) => ({
    ...node,
    review: mergeNodeReview(node.review, review),
    updatedAt: FieldValue.serverTimestamp(),
  }))

  return updateCanvasNodes(canvas, nodes, actor)
}
