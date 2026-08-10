/**
 * GET  /api/v1/admin/agent-org?orgId=...
 * POST /api/v1/admin/agent-org
 *
 * AgentOrgNode org-chart list + create. Auth: admin (ai/admin roles).
 *
 * Every read/write is org-scoped: the orgId is resolved through
 * resolveOrgScope(user, requestedOrgId) and never trusted raw from the body.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { createOrgNode, listOrgNodes, persistChains } from '@/lib/agent-org/store'
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

export const dynamic = 'force-dynamic'

/** Route-level node id contract (stricter than the store's doc-id rules). */
const NODE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
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

function mergeDelegation(raw: unknown, fallback: OrgNodeDelegation): OrgNodeDelegation {
  const delegation: OrgNodeDelegation = { ...fallback }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return delegation
  const source = raw as Record<string, unknown>
  if (isOrgAssignableFrom(source.assignableFrom)) delegation.assignableFrom = source.assignableFrom
  if (typeof source.escalateToManager === 'boolean') delegation.escalateToManager = source.escalateToManager
  if (typeof source.allowLateral === 'boolean') delegation.allowLateral = source.allowLateral
  return delegation
}

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const orgId = req.nextUrl.searchParams.get('orgId')
  const scope = resolveOrgScope(user, orgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const nodes = await listOrgNodes(scope.orgId)
  const tree = buildOrgTree(nodes)
  if (!tree.ok) return apiError(tree.error ?? 'Org chart is inconsistent', 409)

  return apiSuccess({ nodes, tree: tree.roots })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
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

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : ''
  if (!name) return apiError('name is required', 400)
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : ''
  if (!title) return apiError('title is required', 400)

  // id: explicit id → agentId → slugified name. Must match the node id contract.
  let id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : ''
  if (!id) {
    const agentIdCandidate = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : ''
    id = agentIdCandidate || slugify(name)
  }
  if (!NODE_ID_RE.test(id)) {
    return apiError('id must match /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/', 400)
  }

  const agentId = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : null
  const reportsTo = typeof body.reportsTo === 'string' && body.reportsTo.trim() ? body.reportsTo.trim() : null

  // Validate the parent link against existing nodes + the new node before persisting.
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
  if (!reparent.ok) return apiError(reparent.error ?? 'Invalid reportsTo', 400)

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
  if (!result.ok) return apiError(result.error ?? 'Failed to create org node', result.status ?? 500)
  const created = result.node!
  if (!created) return apiError('Created node could not be read back', 500)

  // Refresh chainOfCommand for every node now that the new node exists.
  const all = buildOrgTree([...existing, created])
  if (!all.ok) return apiError(all.error ?? 'Org chart is inconsistent', 409)
  await persistChains(orgId, Array.from(all.byId.values()))
  invalidateOrgNodeCache(orgId)

  return apiSuccess({ node: created }, 201)
})
