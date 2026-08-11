/**
 * Shared AgentOrgNode mutation helpers used by admin + portal routes.
 * Routes own auth/org scope; this module owns validation + store side effects.
 */
import {
  createOrgNode,
  deleteOrgNode,
  listOrgNodes,
  persistChains,
  updateOrgNode,
} from '@/lib/agent-org/store'
import { buildOrgTree, validateReparent } from '@/lib/agent-org/tree'
import { invalidateOrgNodeCache } from '@/lib/agent-org/taskDefaults'
import {
  AGENT_ORG_MAX_CAPABILITIES,
  DEFAULT_ORG_NODE_DELEGATION,
  isOrgAssignableFrom,
  isOrgNodeStatus,
  type AgentOrgNode,
  type OrgNodeDelegation,
} from '@/lib/agent-org/types'
import { cleanAgentEffort, cleanAgentModel } from '@/lib/agents/runRouting'
import { seedOrgChart, type SeedTemplate } from '@/lib/agent-org/seed'

export const NODE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/

export function slugifyNodeId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function cleanCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const clean = item.trim().slice(0, 40)
    if (clean && !out.includes(clean) && out.length < AGENT_ORG_MAX_CAPABILITIES) out.push(clean)
  }
  return out
}

export function mergeDelegation(raw: unknown, fallback: OrgNodeDelegation): OrgNodeDelegation {
  const delegation: OrgNodeDelegation = { ...fallback }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return delegation
  const source = raw as Record<string, unknown>
  if (isOrgAssignableFrom(source.assignableFrom)) delegation.assignableFrom = source.assignableFrom
  if (typeof source.escalateToManager === 'boolean') delegation.escalateToManager = source.escalateToManager
  if (typeof source.allowLateral === 'boolean') delegation.allowLateral = source.allowLateral
  return delegation
}

export async function listOrgChart(orgId: string) {
  const nodes = await listOrgNodes(orgId)
  const tree = buildOrgTree(nodes)
  if (!tree.ok) return { ok: false as const, status: 409 as const, error: tree.error ?? 'Org chart is inconsistent' }
  return { ok: true as const, nodes, tree: tree.roots }
}

export async function createOrgChartNode(orgId: string, body: Record<string, unknown>) {
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : ''
  if (!name) return { ok: false as const, status: 400 as const, error: 'name is required' }
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : ''
  if (!title) return { ok: false as const, status: 400 as const, error: 'title is required' }

  let id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : ''
  if (!id) {
    const agentIdCandidate = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : ''
    id = agentIdCandidate || slugifyNodeId(name)
  }
  if (!NODE_ID_RE.test(id)) {
    return { ok: false as const, status: 400 as const, error: 'id must match /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/' }
  }

  const agentId = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : null
  const reportsTo = typeof body.reportsTo === 'string' && body.reportsTo.trim() ? body.reportsTo.trim() : null

  const existing = await listOrgNodes(orgId)
  const stubNode: AgentOrgNode = {
    id,
    orgId,
    agentId: null,
    name,
    title,
    reportsTo,
    chainOfCommand: [],
    capabilities: [],
    defaultModel: null,
    defaultEffort: null,
    delegation: { ...DEFAULT_ORG_NODE_DELEGATION },
    status: 'active',
    iconKey: '',
    colorKey: '',
    createdAt: null,
    updatedAt: null,
  }
  const reparent = validateReparent([...existing, stubNode], id, reportsTo)
  if (!reparent.ok) return { ok: false as const, status: 400 as const, error: reparent.error ?? 'Invalid reportsTo' }

  const capabilities = cleanCapabilities(body.capabilities)
  const defaultModel = cleanAgentModel(body.defaultModel)
  const defaultEffort = cleanAgentEffort(body.defaultEffort)
  const delegation = mergeDelegation(body.delegation, DEFAULT_ORG_NODE_DELEGATION)
  const status = isOrgNodeStatus(body.status) ? body.status : 'active'
  const iconKey = typeof body.iconKey === 'string' && body.iconKey.trim() ? body.iconKey.trim().slice(0, 40) : 'smart_toy'
  const colorKey = typeof body.colorKey === 'string' && body.colorKey.trim() ? body.colorKey.trim().slice(0, 24) : 'sky'

  const result = await createOrgNode({
    id,
    orgId,
    agentId,
    name,
    title,
    reportsTo,
    chainOfCommand: [],
    capabilities,
    defaultModel,
    defaultEffort,
    delegation,
    status,
    iconKey,
    colorKey,
  })
  if (!result.ok) return { ok: false as const, status: (result.status ?? 500) as number, error: result.error ?? 'Failed to create org node' }
  const created = result.node
  if (!created) return { ok: false as const, status: 500 as const, error: 'Created node could not be read back' }

  const all = buildOrgTree([...existing, created])
  if (!all.ok) return { ok: false as const, status: 409 as const, error: all.error ?? 'Org chart is inconsistent' }
  await persistChains(orgId, Array.from(all.byId.values()))
  invalidateOrgNodeCache(orgId)
  return { ok: true as const, node: created }
}

export async function patchOrgChartNode(orgId: string, nodeId: string, body: Record<string, unknown>) {
  const nodes = await listOrgNodes(orgId)
  const existing = nodes.find((n) => n.id === nodeId)
  if (!existing) return { ok: false as const, status: 404 as const, error: `Org node '${nodeId}' not found` }

  const patch: Record<string, unknown> = {}

  if ('reportsTo' in body) {
    const newReportsTo = typeof body.reportsTo === 'string' && body.reportsTo.trim() ? body.reportsTo.trim() : null
    const check = validateReparent(nodes, nodeId, newReportsTo)
    if (!check.ok) return { ok: false as const, status: 400 as const, error: check.error ?? 'Invalid reportsTo' }
    patch.reportsTo = newReportsTo
  }
  if ('name' in body) {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : ''
    if (!name) return { ok: false as const, status: 400 as const, error: 'name cannot be empty' }
    patch.name = name
  }
  if ('title' in body) {
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : ''
    if (!title) return { ok: false as const, status: 400 as const, error: 'title cannot be empty' }
    patch.title = title
  }
  if ('agentId' in body) {
    patch.agentId = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : null
  }
  if ('capabilities' in body) patch.capabilities = cleanCapabilities(body.capabilities)
  if ('defaultModel' in body) patch.defaultModel = cleanAgentModel(body.defaultModel)
  if ('defaultEffort' in body) patch.defaultEffort = cleanAgentEffort(body.defaultEffort)
  if ('delegation' in body) patch.delegation = mergeDelegation(body.delegation, existing.delegation)
  if ('status' in body) {
    if (!isOrgNodeStatus(body.status)) return { ok: false as const, status: 400 as const, error: 'status must be "active" or "paused"' }
    patch.status = body.status
  }
  if ('iconKey' in body) {
    patch.iconKey = typeof body.iconKey === 'string' && body.iconKey.trim() ? body.iconKey.trim().slice(0, 40) : existing.iconKey
  }
  if ('colorKey' in body) {
    patch.colorKey = typeof body.colorKey === 'string' && body.colorKey.trim() ? body.colorKey.trim().slice(0, 24) : existing.colorKey
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false as const, status: 400 as const, error: 'No valid fields to update' }
  }

  const result = await updateOrgNode(orgId, nodeId, patch)
  if (!result.ok) return { ok: false as const, status: (result.status ?? 500) as number, error: result.error ?? 'Failed to update org node' }
  const updated = result.node!

  const refreshed = await listOrgNodes(orgId)
  await persistChains(orgId, refreshed)
  invalidateOrgNodeCache(orgId)

  const tree = buildOrgTree(refreshed)
  if (!tree.ok) return { ok: false as const, status: 409 as const, error: tree.error ?? 'Org chart is inconsistent' }
  return { ok: true as const, node: updated, tree: tree.roots }
}

export async function removeOrgChartNode(orgId: string, nodeId: string, force: boolean) {
  const nodes = await listOrgNodes(orgId)
  const target = nodes.find((n) => n.id === nodeId)
  if (!target) return { ok: false as const, status: 404 as const, error: `Org node '${nodeId}' not found` }

  const tree = buildOrgTree(nodes)
  if (!tree.ok) return { ok: false as const, status: 409 as const, error: tree.error ?? 'Org chart is inconsistent' }
  const children = tree.byId.get(nodeId)?.children ?? []

  if (children.length > 0 && !force) {
    return {
      ok: false as const,
      status: 409 as const,
      error: 'Cannot delete a node that still has reports; reparent or delete children first',
    }
  }

  if (children.length > 0 && force) {
    const parentId = target.reportsTo
    for (const child of children) {
      const reparent = await updateOrgNode(orgId, child.id, { reportsTo: parentId })
      if (!reparent.ok) {
        return {
          ok: false as const,
          status: (reparent.status ?? 500) as number,
          error: reparent.error ?? `Failed to reparent child '${child.id}'`,
        }
      }
    }
    const after = await listOrgNodes(orgId)
    const afterTree = buildOrgTree(after)
    if (afterTree.ok) await persistChains(orgId, Array.from(afterTree.byId.values()))
  }

  const result = await deleteOrgNode(orgId, nodeId)
  if (!result.ok) return { ok: false as const, status: (result.status ?? 500) as number, error: result.error ?? 'Failed to delete org node' }
  invalidateOrgNodeCache(orgId)
  return { ok: true as const, deleted: true as const }
}

export async function seedOrgChartForOrg(orgId: string, template?: SeedTemplate) {
  return seedOrgChart(orgId, { template })
}
