import {
  DEFAULT_BUDGETS,
  DEFAULT_GATED_CAPABILITIES,
  DEFAULT_LIMITS,
  DEFAULT_NOTIFY,
  DEFAULT_SLA,
  applyTemplateDefaults,
} from './constants'
import { shouldMaterializeKind } from './engine'
import {
  normalizeGraphTemplate,
  validateGraphTemplate,
  type TemplateValidation,
} from './validation'
import type {
  AgentModel,
  GraphNodeTemplate,
  GraphTemplate,
  GraphTemplateBudgets,
  GraphTemplateLimits,
  GraphTemplateNotify,
  GraphTemplateSla,
  GraphTemplateStatus,
  GraphTemplateTrigger,
  GatedCapability,
  WorkflowNodeKind,
} from './types'

/** Suite editor draft — structured, not freeform markdown. */
export type GraphNodeDraft = {
  nodeId: string
  kind: WorkflowNodeKind
  name: string
  dependsOnNodeIds: string[]
  assigneeAgentId?: string
  /** Per-node LLM routing; allowlist options in the Suite editor. */
  agentModel?: AgentModel
  agentInput?: { spec: string; context?: Record<string, unknown>; constraints?: string[] }
  expectedArtifacts?: string[]
  verifierChecklist?: string[]
  reviewerAgentId?: string
  requiredCapability?: string
  approvalGate?: string
  riskLevel?: 'low' | 'medium' | 'high'
  systemAction?: string
  checkType?: string
  checkConfig?: Record<string, unknown>
  waitEventType?: string
  delayMs?: number
  deadlineMs?: number
  budgets?: { maxTokens?: number; maxCost?: number }
}

export type GraphTemplateDraft = {
  id?: string
  orgId: string
  name: string
  status: GraphTemplateStatus
  projectId?: string
  version?: number
  nodes: GraphNodeDraft[]
  triggers: GraphTemplateTrigger[]
  limits: GraphTemplateLimits
  budgets: GraphTemplateBudgets
  notify: GraphTemplateNotify
  sla: GraphTemplateSla
  gatedCapabilities: GatedCapability[]
  pilot?: boolean
  sourcePlaybookId?: string
}

export type NoraControlsExposure = {
  limits: GraphTemplateLimits
  budgets: GraphTemplateBudgets
  notify: GraphTemplateNotify
  sla: GraphTemplateSla
  gatedCapabilities: GatedCapability[]
}

export type MaterializationPreview = {
  kanban: GraphNodeTemplate[]
  ledgerOnly: GraphNodeTemplate[]
  kanbanNodeIds: string[]
  ledgerOnlyNodeIds: string[]
}

function cloneDefaults<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function blankGraphTemplateDraft(input: {
  orgId: string
  projectId?: string
  name?: string
}): GraphTemplateDraft {
  const base = applyTemplateDefaults({
    orgId: input.orgId,
    name: input.name || 'Untitled workflow graph',
    nodes: [],
    projectId: input.projectId,
    status: 'draft',
  })
  return {
    orgId: input.orgId,
    name: base.name,
    status: 'draft',
    projectId: input.projectId,
    version: 1,
    nodes: [],
    triggers: cloneDefaults(base.triggers),
    limits: cloneDefaults(base.limits),
    budgets: cloneDefaults(base.budgets),
    notify: cloneDefaults(base.notify),
    sla: cloneDefaults(base.sla),
    gatedCapabilities: cloneDefaults(base.gatedCapabilities),
  }
}

export function exposeNoraControls(
  source: Pick<GraphTemplateDraft, 'limits' | 'budgets' | 'notify' | 'sla' | 'gatedCapabilities'> | GraphTemplate,
): NoraControlsExposure {
  return {
    limits: { ...DEFAULT_LIMITS, ...(source.limits ?? {}) },
    budgets: { ...DEFAULT_BUDGETS, ...(source.budgets ?? {}) },
    notify: { ...DEFAULT_NOTIFY, ...(source.notify ?? {}) },
    sla: { ...DEFAULT_SLA, ...(source.sla ?? {}) },
    gatedCapabilities:
      Array.isArray(source.gatedCapabilities) && source.gatedCapabilities.length
        ? [...source.gatedCapabilities]
        : [...DEFAULT_GATED_CAPABILITIES],
  }
}

export function draftFromTemplate(template: GraphTemplate): GraphTemplateDraft {
  return {
    id: template.id,
    orgId: template.orgId,
    name: template.name,
    status: template.status,
    projectId: template.projectId,
    version: template.version,
    nodes: template.nodes.map((node) => ({
      nodeId: node.nodeId,
      kind: node.kind,
      name: node.name,
      dependsOnNodeIds: [...(node.dependsOnNodeIds || [])],
      assigneeAgentId: node.assigneeAgentId,
      agentModel: node.agentModel,
      agentInput: node.agentInput
        ? {
            spec: node.agentInput.spec,
            ...(node.agentInput.context ? { context: { ...node.agentInput.context } } : {}),
            ...(node.agentInput.constraints ? { constraints: [...node.agentInput.constraints] } : {}),
          }
        : undefined,
      expectedArtifacts: node.expectedArtifacts ? [...node.expectedArtifacts] : [],
      verifierChecklist: node.verifierChecklist ? [...node.verifierChecklist] : [],
      reviewerAgentId: node.reviewerAgentId,
      requiredCapability: node.requiredCapability,
      approvalGate: node.approvalGate,
      riskLevel: node.riskLevel,
      systemAction: node.systemAction,
      checkType: node.checkType,
      checkConfig: node.checkConfig ? { ...node.checkConfig } : undefined,
      waitEventType: node.waitEventType,
      delayMs: node.delayMs,
      deadlineMs: node.deadlineMs,
      budgets: node.budgets ? { ...node.budgets } : undefined,
    })),
    triggers: (template.triggers || []).map((t) => ({ ...t, filter: t.filter ? { ...t.filter } : undefined })),
    limits: { ...template.limits },
    budgets: { ...template.budgets },
    notify: {
      ...template.notify,
      ceoNotifyOn: template.notify.ceoNotifyOn ? [...template.notify.ceoNotifyOn] : undefined,
    },
    sla: { ...template.sla },
    gatedCapabilities: [...(template.gatedCapabilities || [])],
    pilot: template.pilot,
    sourcePlaybookId: template.sourcePlaybookId,
  }
}

export function materializationPreview(nodes: GraphNodeTemplate[] | GraphNodeDraft[]): MaterializationPreview {
  const asTemplates = nodes.map((node) => node as GraphNodeTemplate)
  const kanban = asTemplates.filter((n) => shouldMaterializeKind(n.kind))
  const ledgerOnly = asTemplates.filter((n) => !shouldMaterializeKind(n.kind))
  return {
    kanban,
    ledgerOnly,
    kanbanNodeIds: kanban.map((n) => n.nodeId),
    ledgerOnlyNodeIds: ledgerOnly.map((n) => n.nodeId),
  }
}

export function serializeAuthoringPayload(
  draft: GraphTemplateDraft,
  orgId: string,
): Record<string, unknown> {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    orgId: orgId || draft.orgId,
    name: draft.name,
    status: draft.status || 'draft',
    version: typeof draft.version === 'number' ? draft.version : 1,
    projectId: draft.projectId,
    pilot: draft.pilot === true,
    sourcePlaybookId: draft.sourcePlaybookId,
    executionBackend: 'workflow_graph',
    triggers: draft.triggers?.length ? draft.triggers : [{ type: 'manual' }],
    limits: draft.limits,
    budgets: draft.budgets,
    notify: draft.notify,
    sla: draft.sla,
    gatedCapabilities: draft.gatedCapabilities,
    nodes: (draft.nodes || []).map((node) => ({
      nodeId: node.nodeId,
      kind: node.kind,
      name: node.name,
      dependsOnNodeIds: node.dependsOnNodeIds || [],
      assigneeAgentId: node.assigneeAgentId,
      agentModel: node.agentModel,
      agentInput: node.agentInput,
      expectedArtifacts: node.expectedArtifacts || [],
      verifierChecklist: node.verifierChecklist || [],
      reviewerAgentId: node.reviewerAgentId,
      requiredCapability: node.requiredCapability,
      approvalGate: node.approvalGate,
      riskLevel: node.riskLevel,
      systemAction: node.systemAction,
      checkType: node.checkType,
      checkConfig: node.checkConfig,
      waitEventType: node.waitEventType,
      delayMs: node.delayMs,
      deadlineMs: node.deadlineMs,
      budgets: node.budgets,
    })),
  }
}

export function buildTemplateFromDraft(
  draft: GraphTemplateDraft,
  orgId: string,
): TemplateValidation {
  const payload = serializeAuthoringPayload(draft, orgId)
  const normalized = normalizeGraphTemplate(payload, { orgId, name: draft.name })
  return validateGraphTemplate(normalized)
}

/** Human-readable law strip for Suite UI — never a second board. */
export function authoringSurfaceCopy() {
  return {
    title: 'Workflow Graph templates',
    subtitle:
      'Structured GraphTemplate authoring on Project Suite. Kanban remains the only task bus — only agent and human_gate nodes materialize there.',
    bans: [
      'No second Graphs board',
      'code_check / system / wait_event / delay stay ledger-only',
      'Done requires proven artifacts + gates',
      'Nora budgets / limits / notify / SLA are first-class fields',
    ],
  }
}
