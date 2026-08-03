import {
  DEFAULT_GATED_CAPABILITIES,
  applyTemplateDefaults,
} from './constants'
import { sha256Hex } from './sha256'
import type {
  GatedCapability,
  GraphNodeTemplate,
  GraphTemplate,
  GraphTemplateStatus,
  WorkflowNodeKind,
} from './types'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => cleanString(item)).filter(Boolean)))
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

const NODE_KINDS = new Set<WorkflowNodeKind>([
  'agent',
  'human_gate',
  'code_check',
  'system',
  'wait_event',
  'delay',
])

export function hashGraphTemplateContent(input: {
  nodes: GraphNodeTemplate[]
  edges?: Array<{ from: string; to: string }>
  limits: GraphTemplate['limits']
  budgets: GraphTemplate['budgets']
  retryPolicy: GraphTemplate['retryPolicy']
  notify: GraphTemplate['notify']
  sla: GraphTemplate['sla']
  gatedCapabilities: GatedCapability[]
}): string {
  const payload = JSON.stringify({
    nodes: input.nodes,
    edges: input.edges ?? [],
    limits: input.limits,
    budgets: input.budgets,
    retryPolicy: input.retryPolicy,
    notify: input.notify,
    sla: input.sla,
    gatedCapabilities: input.gatedCapabilities,
  })
  return sha256Hex(payload)
}

export function normalizeGraphNode(raw: unknown, index: number): GraphNodeTemplate {
  const source = cleanRecord(raw)
  const kind = cleanString(source.kind) as WorkflowNodeKind
  const nodeId = cleanString(source.nodeId) || `node-${index + 1}`
  const name = cleanString(source.name) || nodeId
  const agentInputSource = cleanRecord(source.agentInput)
  const spec = cleanString(agentInputSource.spec)
  const context = cleanRecord(agentInputSource.context)
  const constraints = cleanStringArray(agentInputSource.constraints)

  return {
    nodeId,
    kind: NODE_KINDS.has(kind) ? kind : 'agent',
    name,
    dependsOnNodeIds: cleanStringArray(source.dependsOnNodeIds),
    assigneeAgentId: cleanString(source.assigneeAgentId) || undefined,
    agentInput: spec
      ? {
          spec,
          ...(Object.keys(context).length ? { context } : {}),
          ...(constraints.length ? { constraints } : {}),
        }
      : undefined,
    expectedArtifacts: cleanStringArray(source.expectedArtifacts),
    verifierChecklist: cleanStringArray(source.verifierChecklist),
    reviewerAgentId: cleanString(source.reviewerAgentId) || undefined,
    requiredCapability: cleanString(source.requiredCapability) || undefined,
    riskLevel: (cleanString(source.riskLevel) as GraphNodeTemplate['riskLevel']) || undefined,
    systemAction: cleanString(source.systemAction) || undefined,
    checkType: cleanString(source.checkType) || undefined,
    checkConfig: Object.keys(cleanRecord(source.checkConfig)).length
      ? cleanRecord(source.checkConfig)
      : undefined,
    waitEventType: cleanString(source.waitEventType) || undefined,
    delayMs: typeof source.delayMs === 'number' ? source.delayMs : undefined,
    deadlineMs: typeof source.deadlineMs === 'number' ? source.deadlineMs : undefined,
    limits: cleanRecord(source.limits).maxConcurrent !== undefined
      ? { maxConcurrent: Number(cleanRecord(source.limits).maxConcurrent) }
      : undefined,
    budgets: (() => {
      const budgets = cleanRecord(source.budgets)
      const maxTokens = budgets.maxTokens !== undefined ? Number(budgets.maxTokens) : undefined
      const maxCost = budgets.maxCost !== undefined ? Number(budgets.maxCost) : undefined
      if (maxTokens === undefined && maxCost === undefined) return undefined
      return {
        ...(Number.isFinite(maxTokens) ? { maxTokens } : {}),
        ...(Number.isFinite(maxCost) ? { maxCost } : {}),
      }
    })(),
    retryPolicy: Object.keys(cleanRecord(source.retryPolicy)).length
      ? (cleanRecord(source.retryPolicy) as GraphNodeTemplate['retryPolicy'])
      : undefined,
  }
}

export function normalizeGraphTemplate(
  value: unknown,
  opts?: { orgId?: string; name?: string },
): GraphTemplate {
  const source = cleanRecord(value)
  const nodesSource = Array.isArray(source.nodes) ? source.nodes : []
  const nodes = nodesSource.map((node, index) => normalizeGraphNode(node, index))
  const base = applyTemplateDefaults({
    id: cleanString(source.id) || undefined,
    orgId: cleanString(source.orgId) || cleanString(opts?.orgId),
    name: cleanString(source.name) || cleanString(opts?.name) || 'Untitled graph',
    version: typeof source.version === 'number' && source.version > 0 ? source.version : 1,
    status: (cleanString(source.status) as GraphTemplateStatus) || 'draft',
    nodes,
    edges: Array.isArray(source.edges)
      ? source.edges
          .map((edge) => {
            const record = cleanRecord(edge)
            return { from: cleanString(record.from), to: cleanString(record.to) }
          })
          .filter((edge) => edge.from && edge.to)
      : undefined,
    triggers: Array.isArray(source.triggers)
      ? source.triggers.map((trigger) => {
          const record = cleanRecord(trigger)
          return {
            type: (cleanString(record.type) as 'manual' | 'cron' | 'domain_event') || 'manual',
            cron: cleanString(record.cron) || undefined,
            eventType: cleanString(record.eventType) || undefined,
            filter: Object.keys(cleanRecord(record.filter)).length ? cleanRecord(record.filter) : undefined,
          }
        })
      : undefined,
    limits: Object.keys(cleanRecord(source.limits)).length ? cleanRecord(source.limits) as GraphTemplate['limits'] : undefined,
    budgets: Object.keys(cleanRecord(source.budgets)).length ? cleanRecord(source.budgets) as GraphTemplate['budgets'] : undefined,
    retryPolicy: Object.keys(cleanRecord(source.retryPolicy)).length
      ? cleanRecord(source.retryPolicy) as GraphTemplate['retryPolicy']
      : undefined,
    notify: Object.keys(cleanRecord(source.notify)).length ? cleanRecord(source.notify) as GraphTemplate['notify'] : undefined,
    sla: Object.keys(cleanRecord(source.sla)).length ? cleanRecord(source.sla) as GraphTemplate['sla'] : undefined,
    gatedCapabilities: cleanStringArray(source.gatedCapabilities).filter((cap): cap is GatedCapability =>
      (DEFAULT_GATED_CAPABILITIES as string[]).includes(cap),
    ),
    pilot: source.pilot === true,
    projectId: cleanString(source.projectId) || undefined,
    sourcePlaybookId: cleanString(source.sourcePlaybookId) || undefined,
    createdAt: cleanString(source.createdAt) || undefined,
    updatedAt: cleanString(source.updatedAt) || undefined,
    createdBy: cleanString(source.createdBy) || undefined,
  })

  const versionHash = hashGraphTemplateContent({
    nodes: base.nodes,
    edges: base.edges,
    limits: base.limits,
    budgets: base.budgets,
    retryPolicy: base.retryPolicy,
    notify: base.notify,
    sla: base.sla,
    gatedCapabilities: base.gatedCapabilities,
  })

  return {
    ...base,
    versionHash,
  }
}

export type TemplateValidation =
  | { ok: true; template: GraphTemplate }
  | { ok: false; error: string }

export function validateGraphTemplate(template: GraphTemplate): TemplateValidation {
  if (!template.orgId) return { ok: false, error: 'orgId is required' }
  if (!template.name) return { ok: false, error: 'name is required' }
  if (!template.nodes.length) return { ok: false, error: 'Graph requires at least one node' }
  if (template.nodes.length > 450) return { ok: false, error: 'Graph cannot exceed 450 nodes' }
  if (template.limits.maxConcurrentAgentNodes < 1 || template.limits.maxConcurrentAgentNodes > 8) {
    return { ok: false, error: 'limits.maxConcurrentAgentNodes must be between 1 and 8' }
  }

  const ids = template.nodes.map((node) => node.nodeId)
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'Graph node ids must be unique' }
  const known = new Set(ids)
  const byId = new Map(template.nodes.map((node) => [node.nodeId, node]))

  for (const node of template.nodes) {
    if (!NODE_KINDS.has(node.kind)) return { ok: false, error: `Invalid kind on ${node.nodeId}` }
    if (node.dependsOnNodeIds.some((id) => !known.has(id))) {
      return { ok: false, error: `Unknown dependency on ${node.nodeId}` }
    }

    if (node.kind === 'agent') {
      if (!node.assigneeAgentId) return { ok: false, error: `Agent node ${node.nodeId} requires assigneeAgentId` }
      if (!node.agentInput?.spec) return { ok: false, error: `Agent node ${node.nodeId} requires agentInput.spec` }
      if (!node.expectedArtifacts?.length) {
        return { ok: false, error: `Agent node ${node.nodeId} requires expectedArtifacts` }
      }
    }

    if (node.kind === 'human_gate') {
      if (!node.requiredCapability && !node.expectedArtifacts?.length) {
        return { ok: false, error: `human_gate ${node.nodeId} requires requiredCapability or expectedArtifacts` }
      }
    }

    if (node.kind === 'system') {
      if (!node.systemAction) return { ok: false, error: `system node ${node.nodeId} requires systemAction` }
    }

    if (node.kind === 'code_check') {
      if (!node.checkType) return { ok: false, error: `code_check ${node.nodeId} requires checkType` }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    visiting.add(id)
    const node = byId.get(id)
    for (const dep of node?.dependsOnNodeIds ?? []) {
      if (!visit(dep)) return false
    }
    visiting.delete(id)
    visited.add(id)
    return true
  }
  for (const id of ids) {
    if (!visit(id)) return { ok: false, error: 'Graph node dependencies must not contain a cycle' }
  }

  return { ok: true, template }
}

export function attemptIdempotencyKey(runId: string, nodeId: string, attemptNumber: number): string {
  return `${runId}:${nodeId}:${attemptNumber}`
}

export function runCreateIdempotencyKey(input: {
  orgId: string
  templateId: string
  triggerRef?: string
  windowBucket?: string
}): string {
  const raw = [
    input.orgId,
    input.templateId,
    cleanString(input.triggerRef) || 'manual',
    cleanString(input.windowBucket) || 'open',
  ].join('|')
  return sha256Hex(raw).slice(0, 40)
}
