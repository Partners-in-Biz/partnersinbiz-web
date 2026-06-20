import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  sanitizeCreativeCanvasGraph,
  sanitizeCreativeCanvasInput,
} from './sanitize'
import type {
  CreativeCanvas,
  CreativeCanvasActor,
  CreativeCanvasGraph,
  CreativeCanvasStatus,
  CreativeCanvasVersion,
  CreativeCanvasVisibility,
} from './types'

export const CREATIVE_CANVAS_COLLECTION = 'creative_canvases'
export const CREATIVE_CANVAS_VERSION_COLLECTION = 'creative_canvas_versions'

type CanvasDoc = Record<string, unknown>

const CANVAS_STATUSES: CreativeCanvasStatus[] = ['draft', 'internal_review', 'client_review', 'approved', 'archived']
const VISIBILITIES: CreativeCanvasVisibility[] = ['admin_agents', 'admin_agents_clients']

export class CreativeCanvasVersionConflictError extends Error {
  currentActiveVersion: number
  expectedActiveVersion: number
  conflicts: string[]

  constructor(currentActiveVersion: number, expectedActiveVersion: number, conflicts: string[] = []) {
    super('Creative canvas graph has changed since it was loaded')
    this.name = 'CreativeCanvasVersionConflictError'
    this.currentActiveVersion = currentActiveVersion
    this.expectedActiveVersion = expectedActiveVersion
    this.conflicts = conflicts
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

function graphItemChanged<T>(left: T | undefined, right: T | undefined): boolean {
  return stableStringify(left ?? null) !== stableStringify(right ?? null)
}

function mergeGraphItems<T extends { id: string }>(
  kind: 'node' | 'edge',
  baseItems: T[],
  currentItems: T[],
  proposedItems: T[],
): { merged: T[]; conflicts: string[] } {
  const baseMap = new Map(baseItems.map((item) => [item.id, item]))
  const currentMap = new Map(currentItems.map((item) => [item.id, item]))
  const proposedMap = new Map(proposedItems.map((item) => [item.id, item]))
  const ids = Array.from(new Set([...baseMap.keys(), ...currentMap.keys(), ...proposedMap.keys()]))
  const merged: T[] = []
  const conflicts: string[] = []

  for (const id of ids) {
    const base = baseMap.get(id)
    const current = currentMap.get(id)
    const proposed = proposedMap.get(id)
    const currentChanged = graphItemChanged(current, base)
    const proposedChanged = graphItemChanged(proposed, base)

    if (!proposed) {
      if (base && currentChanged) conflicts.push(`${kind}:${id}`)
      if (!base && current) merged.push(current)
      continue
    }

    if (!current) {
      if (base && proposedChanged) {
        conflicts.push(`${kind}:${id}`)
        continue
      }
      merged.push(proposed)
      continue
    }

    if (currentChanged && proposedChanged && graphItemChanged(current, proposed)) {
      conflicts.push(`${kind}:${id}`)
      continue
    }

    merged.push(proposedChanged ? proposed : current)
  }

  return { merged, conflicts }
}

function mergeCreativeCanvasGraphs(
  base: CreativeCanvasGraph,
  current: CreativeCanvasGraph,
  proposed: CreativeCanvasGraph,
  orgId: string,
): { graph: CreativeCanvasGraph; conflicts: string[] } {
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
    nodes: Array.isArray(data.nodes) ? data.nodes as CreativeCanvas['nodes'] : [],
    edges: Array.isArray(data.edges) ? data.edges as CreativeCanvas['edges'] : [],
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

export async function updateCreativeCanvas(
  id: string,
  orgId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvas & { id: string }> {
  const current = await getCreativeCanvas(id, orgId)
  if (!current) throw new Error('Creative canvas not found')
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const patch = {
    title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : current.title,
    purpose: typeof source.purpose === 'string' ? source.purpose.trim() : current.purpose,
    status: enumPatchValue(source.status, CANVAS_STATUSES, current.status),
    visibility: enumPatchValue(source.visibility, VISIBILITIES, current.visibility),
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
  options: { expectedActiveVersion?: number; mergeOnConflict?: boolean; baseGraphInput?: unknown } = {},
): Promise<CreativeCanvas & { id: string }> {
  const current = await getCreativeCanvas(id, orgId)
  if (!current) throw new Error('Creative canvas not found')
  const proposedGraph: CreativeCanvasGraph = sanitizeCreativeCanvasGraph(graphInput, orgId)
  let graph = proposedGraph
  let versionReason = 'graph_save'
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
      throw new CreativeCanvasVersionConflictError(current.activeVersion, options.expectedActiveVersion, merged.conflicts)
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
