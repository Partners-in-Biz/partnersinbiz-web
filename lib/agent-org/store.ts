/**
 * AgentOrgNode Firestore store — org-scoped CRUD for agent organisation charts.
 *
 * Tenant safety: every read/write is scoped by orgId. Callers must have already
 * resolved + authorised the orgId (use canAccessOrg / resolveOrgScope at the route).
 *
 * Document path: `${orgId}__${logicalNodeId}` so two orgs can share seat names
 * like `coordinator`. Legacy bare document ids remain readable when orgId matches.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  AGENT_ORG_COLLECTION,
  AGENT_ORG_MAX_CAPABILITIES,
  isOrgAssignableFrom,
  isOrgNodeStatus,
  logicalOrgNodeId,
  orgNodeDocId,
  type AgentOrgNode,
  type OrgNodeDelegation,
} from './types'

export type OrgNodeInput = Partial<Omit<AgentOrgNode, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>> & {
  id: string
  orgId: string
}

export interface StoreResult<T = AgentOrgNode> {
  ok: boolean
  node?: T
  nodes?: T[]
  error?: string
  status?: number
}

function cleanCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const clean = item.trim().slice(0, 40)
    if (clean && !out.includes(clean) && out.length < AGENT_ORG_MAX_CAPABILITIES) out.push(clean)
  }
  return out
}

function cleanDelegation(value: unknown, fallback: OrgNodeDelegation): OrgNodeDelegation {
  if (!value || typeof value !== 'object') return { ...fallback }
  const raw = value as Record<string, unknown>
  return {
    assignableFrom: isOrgAssignableFrom(raw.assignableFrom) ? raw.assignableFrom : fallback.assignableFrom,
    escalateToManager: typeof raw.escalateToManager === 'boolean' ? raw.escalateToManager : fallback.escalateToManager,
    allowLateral: typeof raw.allowLateral === 'boolean' ? raw.allowLateral : fallback.allowLateral,
  }
}

function cleanStatus(value: unknown, fallback: AgentOrgNode['status']): AgentOrgNode['status'] {
  return isOrgNodeStatus(value) ? value : fallback
}

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (!id || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) return null
  return id
}

function mapDocToNode(orgId: string, docId: string, data: FirebaseFirestore.DocumentData): AgentOrgNode {
  const id = logicalOrgNodeId(orgId, docId, data.id)
  return {
    ...(data as Omit<AgentOrgNode, 'id'>),
    id,
    orgId: typeof data.orgId === 'string' ? data.orgId : orgId,
    chainOfCommand: Array.isArray(data.chainOfCommand) ? (data.chainOfCommand as string[]) : [],
  }
}

type ResolvedNodeRef = {
  ref: FirebaseFirestore.DocumentReference
  data: FirebaseFirestore.DocumentData
  docId: string
}

/** Resolve logical node id → Firestore doc (composite path, then legacy bare id). */
export async function resolveOrgNodeRef(orgId: string, nodeId: string): Promise<ResolvedNodeRef | null> {
  const coll = adminDb.collection(AGENT_ORG_COLLECTION)
  const compositeId = orgNodeDocId(orgId, nodeId)
  const compositeSnap = await coll.doc(compositeId).get()
  if (compositeSnap.exists) {
    const data = compositeSnap.data()
    if (data && data.orgId === orgId) {
      return { ref: compositeSnap.ref, data, docId: compositeSnap.id }
    }
  }
  if (nodeId !== compositeId) {
    const bareSnap = await coll.doc(nodeId).get()
    if (bareSnap.exists) {
      const data = bareSnap.data()
      if (data && data.orgId === orgId) {
        return { ref: bareSnap.ref, data, docId: bareSnap.id }
      }
    }
  }
  return null
}

/** Normalise an incoming node payload. Returns error on missing/invalid id. */
export function normalizeOrgNodeInput(
  input: OrgNodeInput,
  fallbackDelegation: OrgNodeDelegation,
  fallbackStatus: AgentOrgNode['status'] = 'active',
): { ok: true; value: OrgNodeInput } | { ok: false; error: string; status: number } {
  const id = cleanId(input.id)
  if (!id) {
    return { ok: false, error: 'id must be a non-empty string of letters, numbers, dot, dash or underscore (max 64 chars)', status: 400 }
  }
  const reportsTo = typeof input.reportsTo === 'string' && input.reportsTo.trim() ? input.reportsTo.trim() : null
  if (reportsTo === id) {
    return { ok: false, error: 'A node cannot report to itself', status: 400 }
  }
  return {
    ok: true,
    value: {
      id,
      orgId: input.orgId,
      agentId: typeof input.agentId === 'string' && input.agentId.trim() ? input.agentId.trim() : null,
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : id,
      title: typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 120) : '',
      reportsTo,
      chainOfCommand: [],
      capabilities: cleanCapabilities(input.capabilities),
      defaultModel: typeof input.defaultModel === 'string' && input.defaultModel.trim() ? input.defaultModel.trim() : null,
      defaultEffort: typeof input.defaultEffort === 'string' && input.defaultEffort.trim() ? input.defaultEffort.trim() : null,
      delegation: cleanDelegation(input.delegation, fallbackDelegation),
      status: cleanStatus(input.status, fallbackStatus),
      budget: input.budget && typeof input.budget === 'object' ? { ...(input.budget as Record<string, unknown>) } : undefined,
      iconKey: typeof input.iconKey === 'string' && input.iconKey.trim() ? input.iconKey.trim().slice(0, 40) : 'smart_toy',
      colorKey: typeof input.colorKey === 'string' && input.colorKey.trim() ? input.colorKey.trim().slice(0, 24) : 'sky',
    } as OrgNodeInput,
  }
}

/** List all nodes for an org (no tree derivation; use buildOrgTree on the result).
 * Equality-only query (no orderBy) so a missing composite index cannot 500 the admin UI.
 * Stable sort is applied in memory — org charts are small (tens of nodes, not thousands).
 */
export async function listOrgNodes(orgId: string): Promise<AgentOrgNode[]> {
  const snap = await adminDb
    .collection(AGENT_ORG_COLLECTION)
    .where('orgId', '==', orgId)
    .get()
  const nodes = snap.docs.map((doc) => mapDocToNode(orgId, doc.id, doc.data()))
  return nodes.sort((a, b) => {
    const aMs = createdAtMs(a.createdAt)
    const bMs = createdAtMs(b.createdAt)
    if (aMs !== bMs) return aMs - bMs
    return a.id.localeCompare(b.id)
  })
}

function createdAtMs(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === 'object') {
    const raw = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof raw.toMillis === 'function') {
      try {
        return raw.toMillis()
      } catch {
        /* fall through */
      }
    }
    if (typeof raw.seconds === 'number') return raw.seconds * 1000
    if (typeof raw._seconds === 'number') return raw._seconds * 1000
  }
  return 0
}

export async function getOrgNode(orgId: string, nodeId: string): Promise<AgentOrgNode | null> {
  const resolved = await resolveOrgNodeRef(orgId, nodeId)
  if (!resolved) return null
  return mapDocToNode(orgId, resolved.docId, resolved.data)
}

/** Create a node. Fails if the logical id already exists for this org. */
export async function createOrgNode(input: OrgNodeInput): Promise<StoreResult> {
  const now = FieldValue.serverTimestamp()
  const logicalId = input.id
  const existing = await resolveOrgNodeRef(input.orgId, logicalId)
  if (existing) {
    return { ok: false, status: 409, error: `Org node '${logicalId}' already exists` }
  }

  const docPath = orgNodeDocId(input.orgId, logicalId)
  const ref = adminDb.collection(AGENT_ORG_COLLECTION).doc(docPath)
  const race = await ref.get()
  if (race.exists) {
    return { ok: false, status: 409, error: `Org node '${logicalId}' already exists` }
  }

  await ref.set({
    ...input,
    id: logicalId,
    chainOfCommand: [],
    createdAt: now,
    updatedAt: now,
  })
  const node = await getOrgNode(input.orgId, logicalId)
  if (!node) return { ok: false, status: 500, error: 'Created node could not be read back' }
  return { ok: true, node }
}

/**
 * Update a node with a partial patch. Chain-of-command is recomputed by
 * handlers via buildOrgTree + persistChains after writes.
 */
export async function updateOrgNode(
  orgId: string,
  nodeId: string,
  patch: Partial<Omit<AgentOrgNode, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>>,
): Promise<StoreResult> {
  const resolved = await resolveOrgNodeRef(orgId, nodeId)
  if (!resolved) return { ok: false, status: 404, error: `Org node '${nodeId}' not found` }
  const data = resolved.data as Omit<AgentOrgNode, 'id'>

  const clean: Record<string, unknown> = {
    // Keep logical id durable on legacy bare docs.
    id: logicalOrgNodeId(orgId, resolved.docId, (resolved.data as { id?: unknown }).id ?? nodeId),
  }
  if ('agentId' in patch) clean.agentId = typeof patch.agentId === 'string' && patch.agentId.trim() ? patch.agentId.trim() : null
  if ('name' in patch) clean.name = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim().slice(0, 80) : data.name
  if ('title' in patch) clean.title = typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim().slice(0, 120) : ''
  if ('reportsTo' in patch) clean.reportsTo = typeof patch.reportsTo === 'string' && patch.reportsTo.trim() ? patch.reportsTo.trim() : null
  if ('capabilities' in patch) clean.capabilities = cleanCapabilities(patch.capabilities)
  if ('defaultModel' in patch) clean.defaultModel = typeof patch.defaultModel === 'string' && patch.defaultModel.trim() ? patch.defaultModel.trim() : null
  if ('defaultEffort' in patch) clean.defaultEffort = typeof patch.defaultEffort === 'string' && patch.defaultEffort.trim() ? patch.defaultEffort.trim() : null
  if ('delegation' in patch) clean.delegation = cleanDelegation(patch.delegation, data.delegation)
  if ('status' in patch) clean.status = cleanStatus(patch.status, data.status)
  if ('budget' in patch) clean.budget = patch.budget && typeof patch.budget === 'object' ? { ...(patch.budget as Record<string, unknown>) } : undefined
  if ('iconKey' in patch) clean.iconKey = typeof patch.iconKey === 'string' && patch.iconKey.trim() ? patch.iconKey.trim().slice(0, 40) : data.iconKey
  if ('colorKey' in patch) clean.colorKey = typeof patch.colorKey === 'string' && patch.colorKey.trim() ? patch.colorKey.trim().slice(0, 24) : data.colorKey

  await resolved.ref.update({ ...clean, updatedAt: FieldValue.serverTimestamp() })
  const node = await getOrgNode(orgId, nodeId)
  if (!node) return { ok: false, status: 500, error: 'Updated node could not be read back' }
  return { ok: true, node }
}

/** Delete a node. Callers must handle children (reparent or block) before calling. */
export async function deleteOrgNode(orgId: string, nodeId: string): Promise<StoreResult> {
  const resolved = await resolveOrgNodeRef(orgId, nodeId)
  if (!resolved) return { ok: false, status: 404, error: `Org node '${nodeId}' not found` }
  await resolved.ref.delete()
  return { ok: true }
}

/** Recompute and persist chainOfCommand for every node in an org (after reparent). */
export async function persistChains(orgId: string, nodes: AgentOrgNode[]): Promise<void> {
  if (nodes.length === 0) return
  const batch = adminDb.batch()
  let writes = 0
  for (const node of nodes) {
    const resolved = await resolveOrgNodeRef(orgId, node.id)
    if (!resolved) continue
    batch.update(resolved.ref, {
      chainOfCommand: Array.isArray(node.chainOfCommand) ? node.chainOfCommand : [],
      id: node.id,
      updatedAt: FieldValue.serverTimestamp(),
    })
    writes += 1
  }
  if (writes === 0) return
  await batch.commit()
}
