import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { CREATIVE_CANVAS_COLLECTION, CREATIVE_CANVAS_VERSION_COLLECTION, getCreativeCanvas } from './store'
import { sanitizeCreativeCanvasGraph } from './sanitize'
import type {
  CreativeCanvas,
  CreativeCanvasActor,
  CreativeCanvasBrandStatus,
  CreativeCanvasComment,
  CreativeCanvasGraph,
  CreativeCanvasNode,
  CreativeCanvasOutputKind,
  CreativeCanvasOutputPatch,
  CreativeCanvasPresence,
  CreativeCanvasReviewPatch,
  CreativeCanvasReviewStatus,
  CreativeCanvasRightsStatus,
  CreativeCanvasVersion,
  CreativeCanvasVisibility,
} from './types'

export const CREATIVE_CANVAS_COMMENT_COLLECTION = 'creative_canvas_comments'
export const CREATIVE_CANVAS_PRESENCE_COLLECTION = 'creative_canvas_presence'

type UnknownRecord = Record<string, unknown>

const VISIBILITIES: CreativeCanvasVisibility[] = ['admin_agents', 'admin_agents_clients']
const OUTPUT_KINDS: CreativeCanvasOutputKind[] = ['image', 'video', 'audio', 'caption', 'copy', 'blog_draft', 'document_block', 'book_artifact', 'youtube_render', 'campaign_asset', 'social_post_draft']
const REVIEW_STATUSES: CreativeCanvasReviewStatus[] = ['not_required', 'needed', 'passed', 'warning', 'blocked']
const RIGHTS_STATUSES: CreativeCanvasRightsStatus[] = ['unknown', 'cleared', 'needs_review', 'blocked']
const BRAND_STATUSES: CreativeCanvasBrandStatus[] = ['unknown', 'passed', 'needs_review', 'blocked']
const PRESENCE_DRAFT_NODE_LIMIT = 80
const PRESENCE_DRAFT_EDGE_LIMIT = 160

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

function sanitizePresenceDraftGraph(input: unknown, orgId: string): CreativeCanvasGraph {
  const graph = sanitizeCreativeCanvasGraph(input, orgId)
  const nodes = graph.nodes.slice(0, PRESENCE_DRAFT_NODE_LIMIT)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
    .slice(0, PRESENCE_DRAFT_EDGE_LIMIT)
  return { nodes, edges }
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

function serializeComment(id: string, data: UnknownRecord): CreativeCanvasComment & { id: string } {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    canvasId: String(data.canvasId ?? ''),
    nodeId: cleanString(data.nodeId),
    body: String(data.body ?? ''),
    visibility: VISIBILITIES.includes(data.visibility as CreativeCanvasVisibility)
      ? data.visibility as CreativeCanvasVisibility
      : 'admin_agents',
    resolved: data.resolved === true,
    createdAt: data.createdAt,
    createdBy: String(data.createdBy ?? ''),
    createdByType: data.createdByType === 'agent' || data.createdByType === 'system' ? data.createdByType : 'user',
    updatedAt: data.updatedAt,
  }
}

function serializePresence(id: string, data: UnknownRecord): CreativeCanvasPresence & { id: string } {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    canvasId: String(data.canvasId ?? ''),
    actorUid: String(data.actorUid ?? ''),
    actorType: data.actorType === 'agent' || data.actorType === 'system' ? data.actorType : 'user',
    displayName: cleanString(data.displayName),
    selectedNodeId: cleanString(data.selectedNodeId),
    focus: ['canvas', 'inspector', 'versions', 'comments', 'assets', 'runs'].includes(data.focus as string)
      ? data.focus as CreativeCanvasPresence['focus']
      : undefined,
    viewport: Object.keys(asRecord(data.viewport)).length ? asRecord(data.viewport) as CreativeCanvasPresence['viewport'] : undefined,
    activeVersion: typeof data.activeVersion === 'number' ? data.activeVersion : undefined,
    graphSignature: cleanString(data.graphSignature),
    hasUnsavedGraphChanges: data.hasUnsavedGraphChanges === true,
    nodeCount: typeof data.nodeCount === 'number' && Number.isFinite(data.nodeCount) ? data.nodeCount : undefined,
    edgeCount: typeof data.edgeCount === 'number' && Number.isFinite(data.edgeCount) ? data.edgeCount : undefined,
    selectedNodeTitle: cleanString(data.selectedNodeTitle),
    draftGraph: Object.keys(asRecord(data.draftGraph)).length
      ? sanitizePresenceDraftGraph(data.draftGraph, String(data.orgId ?? ''))
      : undefined,
    lastSeenAt: data.lastSeenAt,
    lastSeenAtMs: typeof data.lastSeenAtMs === 'number' ? data.lastSeenAtMs : 0,
    expiresAtMs: typeof data.expiresAtMs === 'number' ? data.expiresAtMs : 0,
  }
}

function buildVersionSnapshot(
  canvasId: string,
  orgId: string,
  graph: CreativeCanvasGraph,
  version: number,
  actor: CreativeCanvasActor,
  reason: string,
): CreativeCanvasVersion {
  return {
    orgId,
    canvasId,
    version,
    nodes: graph.nodes,
    edges: graph.edges,
    createdBy: actor.uid,
    createdByType: actor.type,
    createdAt: FieldValue.serverTimestamp(),
    reason,
  }
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

export async function getCreativeCanvasVersion(
  canvasId: string,
  orgId: string,
  versionId: string,
): Promise<CreativeCanvasVersion & { id: string }> {
  const snap = await adminDb.collection(CREATIVE_CANVAS_VERSION_COLLECTION).doc(requiredString(versionId, 'versionId')).get()
  if (!snap.exists) throw new Error('Creative canvas version not found')
  const version = serializeVersion(snap.id ?? versionId, snap.data() as UnknownRecord)
  if (version.orgId !== orgId || version.canvasId !== canvasId) throw new Error('Creative canvas version not found')
  return version
}

export async function restoreCreativeCanvasVersion(
  canvasId: string,
  orgId: string,
  versionId: string,
  actor: CreativeCanvasActor,
): Promise<{ canvas: CreativeCanvas & { id: string }; version: CreativeCanvasVersion & { id?: string } }> {
  const canvas = await getCreativeCanvas(canvasId, orgId)
  if (!canvas) throw new Error('Creative canvas not found')
  const sourceVersion = await getCreativeCanvasVersion(canvasId, orgId, versionId)
  const graph = sanitizeCreativeCanvasGraph({ nodes: sourceVersion.nodes, edges: sourceVersion.edges }, orgId)
  const nextVersion = canvas.activeVersion + 1
  const patch = {
    nodes: graph.nodes,
    edges: graph.edges,
    activeVersion: nextVersion,
    updatedBy: actor.uid,
    updatedByType: actor.type,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(canvasId).update(patch)
  const snapshot = buildVersionSnapshot(canvasId, orgId, graph, nextVersion, actor, `restored_from_v${sourceVersion.version}`)
  const ref = await adminDb.collection(CREATIVE_CANVAS_VERSION_COLLECTION).add(snapshot)

  return {
    canvas: { ...canvas, ...patch, updatedAt: canvas.updatedAt },
    version: { id: ref.id, ...snapshot },
  }
}

export async function forkCreativeCanvasVersion(
  canvasId: string,
  orgId: string,
  versionId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<{ canvas: CreativeCanvas & { id: string }; version: CreativeCanvasVersion & { id?: string } }> {
  const sourceCanvas = await getCreativeCanvas(canvasId, orgId)
  if (!sourceCanvas) throw new Error('Creative canvas not found')
  const sourceVersion = await getCreativeCanvasVersion(canvasId, orgId, versionId)
  const graph = sanitizeCreativeCanvasGraph({ nodes: sourceVersion.nodes, edges: sourceVersion.edges }, orgId)
  const body = asRecord(input)
  const title = cleanString(body.title) ?? `${sourceCanvas.title} fork v${sourceVersion.version}`
  const payload: CreativeCanvas = {
    orgId,
    title,
    status: 'draft',
    purpose: sourceCanvas.purpose,
    linked: sourceCanvas.linked,
    activeVersion: 1,
    visibility: sourceCanvas.visibility,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
    createdByType: actor.type,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedByType: actor.type,
    deleted: false,
    nodes: graph.nodes,
    edges: graph.edges,
  }
  const canvasRef = await adminDb.collection(CREATIVE_CANVAS_COLLECTION).add(payload)
  const snapshot = buildVersionSnapshot(canvasRef.id, orgId, graph, 1, actor, `forked_from_${canvasId}_v${sourceVersion.version}`)
  const versionRef = await adminDb.collection(CREATIVE_CANVAS_VERSION_COLLECTION).add(snapshot)

  return {
    canvas: { id: canvasRef.id, ...payload },
    version: { id: versionRef.id, ...snapshot },
  }
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
  return serializeComment(ref.id, payload as unknown as UnknownRecord)
}

export async function listCreativeCanvasComments(
  canvasId: string,
  orgId: string,
): Promise<Array<CreativeCanvasComment & { id: string }>> {
  const snap = await adminDb
    .collection(CREATIVE_CANVAS_COMMENT_COLLECTION)
    .where('orgId', '==', orgId)
    .where('canvasId', '==', canvasId)
    .get()

  return snap.docs
    .map((doc: { id: string; data: () => UnknownRecord }) => serializeComment(doc.id, doc.data()))
    .sort((a, b) => {
      const aMs = typeof a.createdAt === 'object' && a.createdAt && 'toMillis' in a.createdAt
        ? Number((a.createdAt as { toMillis: () => number }).toMillis())
        : 0
      const bMs = typeof b.createdAt === 'object' && b.createdAt && 'toMillis' in b.createdAt
        ? Number((b.createdAt as { toMillis: () => number }).toMillis())
        : 0
      return bMs - aMs
    })
}

export async function listCreativeCanvasPresence(
  canvasId: string,
  orgId: string,
  nowMs = Date.now(),
): Promise<Array<CreativeCanvasPresence & { id: string }>> {
  const snap = await adminDb
    .collection(CREATIVE_CANVAS_PRESENCE_COLLECTION)
    .where('orgId', '==', orgId)
    .where('canvasId', '==', canvasId)
    .get()

  return snap.docs
    .map((doc: { id: string; data: () => UnknownRecord }) => serializePresence(doc.id, doc.data()))
    .filter((presence) => presence.expiresAtMs > nowMs)
    .sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs)
}

export async function heartbeatCreativeCanvasPresence(
  canvasId: string,
  orgId: string,
  input: unknown,
  actor: CreativeCanvasActor,
  nowMs = Date.now(),
): Promise<CreativeCanvasPresence & { id: string }> {
  requiredString(canvasId, 'canvasId')
  requiredString(orgId, 'orgId')
  requiredString(actor.uid, 'actor.uid')
  const body = asRecord(input)
  const viewport = asRecord(body.viewport)
  const nodeCount = typeof body.nodeCount === 'number' && Number.isFinite(body.nodeCount)
    ? Math.max(0, Math.min(1000, Math.round(body.nodeCount)))
    : undefined
  const edgeCount = typeof body.edgeCount === 'number' && Number.isFinite(body.edgeCount)
    ? Math.max(0, Math.min(2000, Math.round(body.edgeCount)))
    : undefined
  const draftGraph = body.hasUnsavedGraphChanges === true && Object.keys(asRecord(body.draftGraph)).length
    ? sanitizePresenceDraftGraph(body.draftGraph, orgId)
    : undefined
  const payload: CreativeCanvasPresence = {
    orgId,
    canvasId,
    actorUid: actor.uid,
    actorType: actor.type,
    displayName: cleanString(body.displayName),
    selectedNodeId: cleanString(body.selectedNodeId),
    focus: ['canvas', 'inspector', 'versions', 'comments', 'assets', 'runs'].includes(body.focus as string)
      ? body.focus as CreativeCanvasPresence['focus']
      : 'canvas',
    viewport: Object.keys(viewport).length ? {
      zoom: typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom) ? viewport.zoom : undefined,
      x: typeof viewport.x === 'number' && Number.isFinite(viewport.x) ? viewport.x : undefined,
      y: typeof viewport.y === 'number' && Number.isFinite(viewport.y) ? viewport.y : undefined,
    } : undefined,
    activeVersion: typeof body.activeVersion === 'number' && Number.isFinite(body.activeVersion)
      ? Math.max(0, Math.round(body.activeVersion))
      : undefined,
    graphSignature: cleanString(body.graphSignature),
    hasUnsavedGraphChanges: body.hasUnsavedGraphChanges === true,
    nodeCount,
    edgeCount,
    selectedNodeTitle: cleanString(body.selectedNodeTitle),
    draftGraph,
    lastSeenAt: FieldValue.serverTimestamp(),
    lastSeenAtMs: nowMs,
    expiresAtMs: nowMs + 45_000,
  }
  const presenceId = `${canvasId}:${actor.uid}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  await adminDb.collection(CREATIVE_CANVAS_PRESENCE_COLLECTION).doc(presenceId).set(payload, { merge: true })
  return { id: presenceId, ...payload }
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
