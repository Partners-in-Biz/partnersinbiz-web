/**
 * PATCH  /api/v1/admin/agent-org/:nodeId — partial update of an org node
 * DELETE /api/v1/admin/agent-org/:nodeId?orgId=...&force=true — delete
 *
 * Auth: admin. Reparent validation runs against the full org node set before
 * persisting; deleting a node with children is blocked unless force=true
 * (children are reparented to the deleted node's parent first).
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { deleteOrgNode, listOrgNodes, persistChains, updateOrgNode } from '@/lib/agent-org/store'
import { buildOrgTree, validateReparent } from '@/lib/agent-org/tree'
import { invalidateOrgNodeCache } from '@/lib/agent-org/taskDefaults'
import {
  AGENT_ORG_MAX_CAPABILITIES,
  isOrgAssignableFrom,
  isOrgNodeStatus,
  type OrgNodeDelegation,
} from '@/lib/agent-org/types'
import { cleanAgentEffort, cleanAgentModel } from '@/lib/agents/runRouting'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ nodeId: string }> }

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

function mergeDelegation(raw: unknown, fallback: OrgNodeDelegation): OrgNodeDelegation {
  const delegation: OrgNodeDelegation = { ...fallback }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return delegation
  const source = raw as Record<string, unknown>
  if (isOrgAssignableFrom(source.assignableFrom)) delegation.assignableFrom = source.assignableFrom
  if (typeof source.escalateToManager === 'boolean') delegation.escalateToManager = source.escalateToManager
  if (typeof source.allowLateral === 'boolean') delegation.allowLateral = source.allowLateral
  return delegation
}

export const PATCH = withAuth('admin', async (req: NextRequest, user, ctx: RouteCtx) => {
  const { nodeId } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  const nodes = await listOrgNodes(orgId)
  const existing = nodes.find((n) => n.id === nodeId)
  if (!existing) return apiError(`Org node '${nodeId}' not found`, 404)

  const patch: Record<string, unknown> = {}

  if ('reportsTo' in body) {
    const newReportsTo = typeof body.reportsTo === 'string' && body.reportsTo.trim() ? body.reportsTo.trim() : null
    // Validate the move against the full (pre-move) org set before persisting.
    const check = validateReparent(nodes, nodeId, newReportsTo)
    if (!check.ok) return apiError(check.error ?? 'Invalid reportsTo', 400)
    patch.reportsTo = newReportsTo
  }

  if ('name' in body) {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : ''
    if (!name) return apiError('name cannot be empty', 400)
    patch.name = name
  }
  if ('title' in body) {
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : ''
    if (!title) return apiError('title cannot be empty', 400)
    patch.title = title
  }
  if ('agentId' in body) {
    patch.agentId = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : null
  }
  if ('capabilities' in body) {
    patch.capabilities = cleanCapabilities(body.capabilities)
  }
  if ('defaultModel' in body) {
    patch.defaultModel = cleanAgentModel(body.defaultModel)
  }
  if ('defaultEffort' in body) {
    patch.defaultEffort = cleanAgentEffort(body.defaultEffort)
  }
  if ('delegation' in body) {
    patch.delegation = mergeDelegation(body.delegation, existing.delegation)
  }
  if ('status' in body) {
    if (!isOrgNodeStatus(body.status)) return apiError('status must be "active" or "paused"', 400)
    patch.status = body.status
  }
  if ('iconKey' in body) {
    patch.iconKey = typeof body.iconKey === 'string' && body.iconKey.trim() ? body.iconKey.trim().slice(0, 40) : existing.iconKey
  }
  if ('colorKey' in body) {
    patch.colorKey = typeof body.colorKey === 'string' && body.colorKey.trim() ? body.colorKey.trim().slice(0, 24) : existing.colorKey
  }

  if (Object.keys(patch).length === 0) {
    return apiError('No valid fields to update', 400)
  }

  const result = await updateOrgNode(orgId, nodeId, patch)
  if (!result.ok) return apiError(result.error ?? 'Failed to update org node', result.status ?? 500)
  const updated = result.node!

  // Refresh chainOfCommand for every node after the patch.
  const refreshed = await listOrgNodes(orgId)
  await persistChains(orgId, refreshed)
  invalidateOrgNodeCache(orgId)

  const tree = buildOrgTree(refreshed)
  if (!tree.ok) return apiError(tree.error ?? 'Org chart is inconsistent', 409)

  return apiSuccess({ node: updated, tree: tree.roots })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user, ctx: RouteCtx) => {
  const { nodeId } = await ctx.params

  const requestedOrgId = req.nextUrl.searchParams.get('orgId')
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  const nodes = await listOrgNodes(orgId)
  const target = nodes.find((n) => n.id === nodeId)
  if (!target) return apiError(`Org node '${nodeId}' not found`, 404)

  const tree = buildOrgTree(nodes)
  if (!tree.ok) return apiError(tree.error ?? 'Org chart is inconsistent', 409)
  const children = tree.byId.get(nodeId)?.children ?? []

  const force = req.nextUrl.searchParams.get('force') === 'true'
  if (children.length > 0 && !force) {
    return apiError('Cannot delete a node that still has reports; reparent or delete children first', 409)
  }

  if (children.length > 0 && force) {
    // Reparent children to the deleted node's parent, then refresh chains.
    const parentId = target.reportsTo
    for (const child of children) {
      const reparent = await updateOrgNode(orgId, child.id, { reportsTo: parentId })
      if (!reparent.ok) return apiError(reparent.error ?? `Failed to reparent child '${child.id}'`, reparent.status ?? 500)
    }
    const after = await listOrgNodes(orgId)
    const afterTree = buildOrgTree(after)
    if (afterTree.ok) await persistChains(orgId, Array.from(afterTree.byId.values()))
  }

  const result = await deleteOrgNode(orgId, nodeId)
  if (!result.ok) return apiError(result.error ?? 'Failed to delete org node', result.status ?? 500)
  invalidateOrgNodeCache(orgId)

  return apiSuccess({ deleted: true })
})
