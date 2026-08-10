/**
 * AgentOrgNode task defaults — resolve default agentModel / agentEffort for a
 * task from the assignee's org chart node, so frontend work defaults to a
 * Claude-leaning model, backend to GPT/Codex, etc., without hand-picking each time.
 *
 * Defaults only apply when the task does NOT already carry an explicit
 * agentModel / agentEffort. If the node carries no default, the task is
 * left untouched (existing behaviour preserved).
 *
 * Only model IDs that are valid for agent tasks are honoured
 * (see lib/llm-providers/model-registry.ts: isAgentTaskModel / agentTaskModelOptions).
 */
import { cleanAgentEffort, cleanAgentModel, type AgentEffort, type AgentModel } from '@/lib/agents/runRouting'
import { listOrgNodes } from './store'
import type { AgentOrgNode } from './types'

export interface OrgTaskDefaults {
  agentId: string
  agentModel?: AgentModel
  agentEffort?: AgentEffort
}

/** In-memory cache per org (per serverless instance) to avoid hot-path reads. */
const cache = new Map<string, { t: number; byAgentId: Map<string, AgentOrgNode> }>()
const CACHE_TTL_MS = 30_000

async function loadNodesCached(orgId: string): Promise<AgentOrgNode[]> {
  const hit = cache.get(orgId)
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return Array.from(hit.byAgentId.values())
  const nodes = await listOrgNodes(orgId)
  const byAgentId = new Map<string, AgentOrgNode>()
  for (const node of nodes) if (node.agentId) byAgentId.set(node.agentId, node)
  cache.set(orgId, { t: Date.now(), byAgentId })
  return nodes
}

/** Drop the cached org snapshot (call after create/update/delete in the same instance). */
export function invalidateOrgNodeCache(orgId: string): void {
  cache.delete(orgId)
}

/**
 * Resolve task defaults from the assignee's org node.
 * Returns only values that are set on the node AND valid for agent tasks.
 */
export async function resolveOrgTaskDefaults(orgId: string, agentId: string | null | undefined): Promise<OrgTaskDefaults | null> {
  if (!agentId) return null
  const nodes = await loadNodesCached(orgId)
  const node = nodes.find((n) => n.agentId === agentId)
  if (!node) return null

  const out: OrgTaskDefaults = { agentId }
  const model = cleanAgentModel(node.defaultModel)
  if (model) out.agentModel = model
  const effort = cleanAgentEffort(node.defaultEffort)
  if (effort && effort !== 'none') out.agentEffort = effort
  return out
}

/**
 * Apply node defaults onto a task payload (in place, returns changes applied).
 * Only fills fields that are currently empty/unset and never overrides explicit
 * values already on the task.
 */
export function applyOrgNodeDefaults(
  task: { agentId?: string | null; agentModel?: string | null; agentEffort?: string | null },
  defaults: OrgTaskDefaults | null,
): { appliedModel: boolean; appliedEffort: boolean } {
  const result = { appliedModel: false, appliedEffort: false }
  if (!defaults) return result
  if (task.agentId !== defaults.agentId) return result
  if ((!task.agentModel || task.agentModel === '') && defaults.agentModel) {
    task.agentModel = defaults.agentModel
    result.appliedModel = true
  }
  if ((!task.agentEffort || task.agentEffort === '') && defaults.agentEffort) {
    task.agentEffort = defaults.agentEffort
    result.appliedEffort = true
  }
  return result
}

/** Convenience: resolve + apply in one call for a task payload. */
export async function applyOrgNodeDefaultsToTask(
  orgId: string,
  task: { agentId?: string | null; agentModel?: string | null; agentEffort?: string | null },
): Promise<{ appliedModel: boolean; appliedEffort: boolean }> {
  const defaults = await resolveOrgTaskDefaults(orgId, task.agentId)
  return applyOrgNodeDefaults(task, defaults)
}
