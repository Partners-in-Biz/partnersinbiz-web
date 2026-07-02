import { randomBytes } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  cleanLinked,
  sanitizeCreativeCanvasGraph,
  sanitizeCreativeCanvasData,
  sanitizeCreativeCanvasInput,
} from './sanitize'
import type {
  CreativeCanvas,
  CreativeCanvasActor,
  CreativeCanvasGraph,
  CreativeCanvasGraphConflictDetail,
  CreativeCanvasStatus,
  CreativeCanvasTemplate,
  CreativeCanvasVersion,
  CreativeCanvasVisibility,
} from './types'

export const CREATIVE_CANVAS_COLLECTION = 'creative_canvases'
export const CREATIVE_CANVAS_VERSION_COLLECTION = 'creative_canvas_versions'
export const CREATIVE_CANVAS_TEMPLATE_COLLECTION = 'creative_canvas_templates'

type CanvasDoc = Record<string, unknown>

const CANVAS_STATUSES: CreativeCanvasStatus[] = ['draft', 'internal_review', 'client_review', 'approved', 'archived']
const VISIBILITIES: CreativeCanvasVisibility[] = ['admin_agents', 'admin_agents_clients']

export class CreativeCanvasVersionConflictError extends Error {
  currentActiveVersion: number
  expectedActiveVersion: number
  conflicts: string[]
  conflictDetails: CreativeCanvasGraphConflictDetail[]

  constructor(
    currentActiveVersion: number,
    expectedActiveVersion: number,
    conflicts: string[] = [],
    conflictDetails: CreativeCanvasGraphConflictDetail[] = [],
  ) {
    super('Creative canvas graph has changed since it was loaded')
    this.name = 'CreativeCanvasVersionConflictError'
    this.currentActiveVersion = currentActiveVersion
    this.expectedActiveVersion = expectedActiveVersion
    this.conflicts = conflicts
    this.conflictDetails = conflictDetails
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function graphItemChanged<T>(left: T | undefined, right: T | undefined): boolean {
  return stableStringify(left ?? null) !== stableStringify(right ?? null)
}

function graphItemLabel<T extends { id: string }>(kind: 'node' | 'edge', item: T | undefined): string | undefined {
  if (!item) return undefined
  const record = item as Record<string, unknown>
  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : undefined
  const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : undefined
  if (title) return title
  if (label) return label
  if (kind === 'edge') {
    const sourceNodeId = typeof record.sourceNodeId === 'string' ? record.sourceNodeId : undefined
    const targetNodeId = typeof record.targetNodeId === 'string' ? record.targetNodeId : undefined
    if (sourceNodeId && targetNodeId) return `${sourceNodeId} -> ${targetNodeId}`
  }
  return item.id
}

function graphConflictDetail<T extends { id: string }>(
  kind: 'node' | 'edge',
  id: string,
  reason: CreativeCanvasGraphConflictDetail['reason'],
  base: T | undefined,
  current: T | undefined,
  proposed: T | undefined,
): CreativeCanvasGraphConflictDetail {
  return {
    id,
    kind,
    reason,
    label: graphItemLabel(kind, proposed) ?? graphItemLabel(kind, current) ?? graphItemLabel(kind, base) ?? id,
    baseLabel: graphItemLabel(kind, base),
    currentLabel: graphItemLabel(kind, current),
    proposedLabel: graphItemLabel(kind, proposed),
  }
}

function mergeGraphItems<T extends { id: string }>(
  kind: 'node' | 'edge',
  baseItems: T[],
  currentItems: T[],
  proposedItems: T[],
): { merged: T[]; conflicts: string[]; conflictDetails: CreativeCanvasGraphConflictDetail[] } {
  const baseMap = new Map(baseItems.map((item) => [item.id, item]))
  const currentMap = new Map(currentItems.map((item) => [item.id, item]))
  const proposedMap = new Map(proposedItems.map((item) => [item.id, item]))
  const ids = Array.from(new Set([...baseMap.keys(), ...currentMap.keys(), ...proposedMap.keys()]))
  const merged: T[] = []
  const conflicts: string[] = []
  const conflictDetails: CreativeCanvasGraphConflictDetail[] = []

  for (const id of ids) {
    const base = baseMap.get(id)
    const current = currentMap.get(id)
    const proposed = proposedMap.get(id)
    const currentChanged = graphItemChanged(current, base)
    const proposedChanged = graphItemChanged(proposed, base)

    if (!proposed) {
      if (base && currentChanged) {
        conflicts.push(`${kind}:${id}`)
        conflictDetails.push(graphConflictDetail(kind, id, 'deleted_locally', base, current, proposed))
      }
      if (!base && current) merged.push(current)
      continue
    }

    if (!current) {
      if (base && proposedChanged) {
        conflicts.push(`${kind}:${id}`)
        conflictDetails.push(graphConflictDetail(kind, id, 'deleted_remotely', base, current, proposed))
        continue
      }
      merged.push(proposed)
      continue
    }

    if (currentChanged && proposedChanged && graphItemChanged(current, proposed)) {
      conflicts.push(`${kind}:${id}`)
      conflictDetails.push(graphConflictDetail(kind, id, 'concurrent_update', base, current, proposed))
      continue
    }

    merged.push(proposedChanged ? proposed : current)
  }

  return { merged, conflicts, conflictDetails }
}

function mergeCreativeCanvasGraphs(
  base: CreativeCanvasGraph,
  current: CreativeCanvasGraph,
  proposed: CreativeCanvasGraph,
  orgId: string,
): { graph: CreativeCanvasGraph; conflicts: string[]; conflictDetails: CreativeCanvasGraphConflictDetail[] } {
  const nodeMerge = mergeGraphItems('node', base.nodes, current.nodes, proposed.nodes)
  const edgeMerge = mergeGraphItems('edge', base.edges, current.edges, proposed.edges)
  const mergedNodeIds = new Set(nodeMerge.merged.map((node) => node.id))
  const mergedEdges = edgeMerge.merged.filter((edge) => (
    mergedNodeIds.has(edge.sourceNodeId) && mergedNodeIds.has(edge.targetNodeId)
  ))
  const graph = sanitizeCreativeCanvasGraph({ nodes: nodeMerge.merged, edges: mergedEdges }, orgId)
  return {
    graph,
    conflicts: [...nodeMerge.conflicts, ...edgeMerge.conflicts],
    conflictDetails: [...nodeMerge.conflictDetails, ...edgeMerge.conflictDetails],
  }
}

function enumPatchValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

function serializeCreativeCanvas(id: string, data: CanvasDoc): CreativeCanvas & { id: string } {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    title: String(data.title ?? 'Untitled canvas'),
    status: (data.status as CreativeCanvas['status']) ?? 'draft',
    purpose: String(data.purpose ?? ''),
    data: plainRecord(data.data),
    linked: (data.linked as CreativeCanvas['linked']) ?? {},
    activeVersion: typeof data.activeVersion === 'number' ? data.activeVersion : 1,
    visibility: (data.visibility as CreativeCanvas['visibility']) ?? 'admin_agents',
    createdAt: data.createdAt,
    createdBy: String(data.createdBy ?? ''),
    createdByType: (data.createdByType as CreativeCanvas['createdByType']) ?? 'user',
    updatedAt: data.updatedAt,
    updatedBy: String(data.updatedBy ?? ''),
    updatedByType: (data.updatedByType as CreativeCanvas['updatedByType']) ?? 'user',
    deleted: data.deleted === true,
    ...(typeof data.shareToken === 'string' && data.shareToken ? { shareToken: data.shareToken } : {}),
    ...(typeof data.shareEnabled === 'boolean' ? { shareEnabled: data.shareEnabled } : {}),
    nodes: Array.isArray(data.nodes) ? data.nodes as CreativeCanvas['nodes'] : [],
    edges: Array.isArray(data.edges) ? data.edges as CreativeCanvas['edges'] : [],
  }
}

function serializeCreativeCanvasTemplate(id: string, data: CanvasDoc): CreativeCanvasTemplate & { id: string } {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    title: String(data.title ?? 'Untitled template'),
    description: typeof data.description === 'string' ? data.description : undefined,
    category: typeof data.category === 'string' ? data.category : undefined,
    sourceCanvasId: typeof data.sourceCanvasId === 'string' ? data.sourceCanvasId : undefined,
    sourceVersion: typeof data.sourceVersion === 'number' ? data.sourceVersion : undefined,
    nodes: Array.isArray(data.nodes) ? data.nodes as CreativeCanvasTemplate['nodes'] : [],
    edges: Array.isArray(data.edges) ? data.edges as CreativeCanvasTemplate['edges'] : [],
    createdAt: data.createdAt,
    createdBy: String(data.createdBy ?? ''),
    createdByType: (data.createdByType as CreativeCanvasTemplate['createdByType']) ?? 'user',
    updatedAt: data.updatedAt,
    updatedBy: String(data.updatedBy ?? ''),
    updatedByType: (data.updatedByType as CreativeCanvasTemplate['updatedByType']) ?? 'user',
    deleted: data.deleted === true,
  }
}

function cleanTemplateString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sanitizeCreativeCanvasTemplateInput(
  input: unknown,
  orgId: string,
  actor: CreativeCanvasActor,
): Omit<CreativeCanvasTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const graph = sanitizeCreativeCanvasGraph(body, orgId)
  if (!graph.nodes.length) throw new Error('template requires at least one node')
  return {
    orgId,
    title: cleanTemplateString(body.title) ?? 'Untitled template',
    description: cleanTemplateString(body.description),
    category: cleanTemplateString(body.category) ?? 'custom',
    sourceCanvasId: cleanTemplateString(body.sourceCanvasId),
    sourceVersion: typeof body.sourceVersion === 'number' && Number.isFinite(body.sourceVersion)
      ? body.sourceVersion
      : undefined,
    nodes: graph.nodes,
    edges: graph.edges,
    createdBy: actor.uid,
    createdByType: actor.type,
    updatedBy: actor.uid,
    updatedByType: actor.type,
    deleted: false,
  }
}

function buildVersionSnapshot(
  canvasId: string,
  orgId: string,
  graph: CreativeCanvasGraph,
  version: number,
  actor: CreativeCanvasActor,
  reason = 'graph_save',
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

export async function listCreativeCanvases(orgId: string): Promise<Array<CreativeCanvas & { id: string }>> {
  const snap = await adminDb.collection(CREATIVE_CANVAS_COLLECTION).where('orgId', '==', orgId).get()
  return snap.docs
    .map((doc: { id: string; data: () => CanvasDoc }) => serializeCreativeCanvas(doc.id, doc.data()))
    .filter((canvas) => canvas.deleted !== true)
    .sort((a, b) => a.title.localeCompare(b.title))
}

export async function listCreativeCanvasTemplates(orgId: string): Promise<Array<CreativeCanvasTemplate & { id: string }>> {
  const snap = await adminDb.collection(CREATIVE_CANVAS_TEMPLATE_COLLECTION).where('orgId', '==', orgId).get()
  return snap.docs
    .map((doc: { id: string; data: () => CanvasDoc }) => serializeCreativeCanvasTemplate(doc.id, doc.data()))
    .filter((template) => template.deleted !== true)
    .sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Toggle the public read-only share link. Enabling mints a token once and
 * reuses it on re-enable (stable URLs); disabling only flips the flag.
 */
export async function setCreativeCanvasShareEnabled(
  id: string,
  orgId: string,
  enabled: boolean,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvas & { id: string }> {
  const current = await getCreativeCanvas(id, orgId)
  if (!current) throw new Error('Creative canvas not found')
  const shareToken = current.shareToken ?? randomBytes(12).toString('hex')
  const patch = {
    shareToken,
    shareEnabled: enabled,
    updatedBy: actor.uid,
    updatedByType: actor.type,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(id).update(patch)
  return { ...current, ...patch }
}

/** Public share lookup: org-independent, only enabled + non-deleted canvases. */
export async function getCreativeCanvasByShareToken(token: string): Promise<(CreativeCanvas & { id: string }) | null> {
  const cleanToken = typeof token === 'string' ? token.trim() : ''
  if (cleanToken.length < 8) return null
  const snap = await adminDb.collection(CREATIVE_CANVAS_COLLECTION)
    .where('shareToken', '==', cleanToken)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  const canvas = serializeCreativeCanvas(doc.id, doc.data() as CanvasDoc)
  if (canvas.shareEnabled !== true || canvas.deleted) return null
  return canvas
}

export async function getCreativeCanvas(id: string, orgId: string): Promise<(CreativeCanvas & { id: string }) | null> {
  const snap = await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(id).get()
  if (!snap.exists) return null
  const canvas = serializeCreativeCanvas(snap.id ?? id, snap.data() as CanvasDoc)
  if (canvas.orgId !== orgId || canvas.deleted === true) return null
  return canvas
}

export async function createCreativeCanvas(
  input: unknown,
  orgId: string,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvas & { id: string }> {
  const data = sanitizeCreativeCanvasInput(input, orgId, actor)
  const payload = {
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  const ref = await adminDb.collection(CREATIVE_CANVAS_COLLECTION).add(payload)
  return serializeCreativeCanvas(ref.id, payload)
}

export async function createCreativeCanvasTemplate(
  input: unknown,
  orgId: string,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvasTemplate & { id: string }> {
  const data = sanitizeCreativeCanvasTemplateInput(input, orgId, actor)
  const payload = {
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  const ref = await adminDb.collection(CREATIVE_CANVAS_TEMPLATE_COLLECTION).add(payload)
  return serializeCreativeCanvasTemplate(ref.id, payload)
}

export async function updateCreativeCanvas(
  id: string,
  orgId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvas & { id: string }> {
  const current = await getCreativeCanvas(id, orgId)
  if (!current) throw new Error('Creative canvas not found')
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const currentData = plainRecord(current.data)
  const inputData = plainRecord(source.data)
  const sourceData = Object.prototype.hasOwnProperty.call(source, 'data')
    ? sanitizeCreativeCanvasData({
      ...currentData,
      ...inputData,
      visualProof: {
        ...plainRecord(currentData.visualProof),
        ...plainRecord(inputData.visualProof),
      },
      benchmarkProof: {
        ...plainRecord(currentData.benchmarkProof),
        ...plainRecord(inputData.benchmarkProof),
      },
    })
    : current.data ?? {}
  const patch = {
    title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : current.title,
    purpose: typeof source.purpose === 'string' ? source.purpose.trim() : current.purpose,
    data: sourceData,
    status: enumPatchValue(source.status, CANVAS_STATUSES, current.status),
    visibility: enumPatchValue(source.visibility, VISIBILITIES, current.visibility),
    // Merge linked module ids so a canvas can be linked (e.g. to a Book Studio
    // project) after creation — previously PATCH silently dropped `linked`.
    linked: Object.prototype.hasOwnProperty.call(source, 'linked')
      ? { ...(current.linked ?? {}), ...cleanLinked(source.linked) }
      : current.linked ?? {},
    deleted: typeof source.deleted === 'boolean' ? source.deleted : current.deleted === true,
    updatedBy: actor.uid,
    updatedByType: actor.type,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(id).update(patch)
  return { ...current, ...patch }
}

export async function updateCreativeCanvasGraph(
  id: string,
  orgId: string,
  graphInput: unknown,
  actor: CreativeCanvasActor,
  options: { expectedActiveVersion?: number; mergeOnConflict?: boolean; baseGraphInput?: unknown; reason?: string } = {},
): Promise<CreativeCanvas & { id: string }> {
  const current = await getCreativeCanvas(id, orgId)
  if (!current) throw new Error('Creative canvas not found')
  const proposedGraph: CreativeCanvasGraph = sanitizeCreativeCanvasGraph(graphInput, orgId)
  let graph = proposedGraph
  let versionReason = typeof options.reason === 'string' && options.reason.trim()
    ? options.reason.trim().slice(0, 80)
    : 'graph_save'
  if (
    typeof options.expectedActiveVersion === 'number'
    && Number.isFinite(options.expectedActiveVersion)
    && options.expectedActiveVersion !== current.activeVersion
  ) {
    if (!options.mergeOnConflict || !options.baseGraphInput) {
      throw new CreativeCanvasVersionConflictError(current.activeVersion, options.expectedActiveVersion)
    }
    const baseGraph = sanitizeCreativeCanvasGraph(options.baseGraphInput, orgId)
    const merged = mergeCreativeCanvasGraphs(
      baseGraph,
      { nodes: current.nodes, edges: current.edges },
      proposedGraph,
      orgId,
    )
    if (merged.conflicts.length) {
      throw new CreativeCanvasVersionConflictError(
        current.activeVersion,
        options.expectedActiveVersion,
        merged.conflicts,
        merged.conflictDetails,
      )
    }
    graph = merged.graph
    versionReason = `graph_auto_merge_from_v${options.expectedActiveVersion}`
  }
  const nextVersion = current.activeVersion + 1
  const patch = {
    nodes: graph.nodes,
    edges: graph.edges,
    activeVersion: nextVersion,
    updatedBy: actor.uid,
    updatedByType: actor.type,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(id).update(patch)
  await adminDb.collection(CREATIVE_CANVAS_VERSION_COLLECTION).add(buildVersionSnapshot(id, orgId, graph, nextVersion, actor, versionReason))
  return {
    ...current,
    ...patch,
    updatedAt: current.updatedAt,
  }
}
