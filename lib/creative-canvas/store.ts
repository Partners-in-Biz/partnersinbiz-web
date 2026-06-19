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
    reason: 'graph_save',
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
): Promise<CreativeCanvas & { id: string }> {
  const current = await getCreativeCanvas(id, orgId)
  if (!current) throw new Error('Creative canvas not found')
  const graph: CreativeCanvasGraph = sanitizeCreativeCanvasGraph(graphInput, orgId)
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
  await adminDb.collection(CREATIVE_CANVAS_VERSION_COLLECTION).add(buildVersionSnapshot(id, orgId, graph, nextVersion, actor))
  return {
    ...current,
    ...patch,
    updatedAt: current.updatedAt,
  }
}
