export type LoopRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type LoopTriggerKind = 'cron' | 'event' | 'task-state' | 'manual-review' | 'signal'

export type LoopActionKind =
  | 'read'
  | 'draft'
  | 'task-create'
  | 'task-release'
  | 'task-review'
  | 'message-draft'
  | 'report'

export type LoopApprovalGate =
  | 'client-visible'
  | 'public-publishing'
  | 'paid-spend'
  | 'production-deploy'
  | 'finance'
  | 'secret-config'
  | 'destructive-data'
  | 'human-review'

export type LoopRegistryEntry = {
  id: string
  name: string
  status: 'active' | 'planned' | 'guarded'
  ownerAgentId: string
  reviewerAgentId: string
  riskLevel: LoopRiskLevel
  trigger: {
    kind: LoopTriggerKind
    description: string
  }
  dataSources: string[]
  allowedActions: LoopActionKind[]
  approvalGates: LoopApprovalGate[]
  evidenceRequirements: string[]
  staleThreshold: string
  lastDecision: string
  whyItMatters: string
}

export const LOOP_REGISTRY: LoopRegistryEntry[] = [
  {
    id: 'agent-task-watcher',
    name: 'Agent Task Watcher Loop',
    status: 'active',
    ownerAgentId: 'pip',
    reviewerAgentId: 'qa-release',
    riskLevel: 'medium',
    trigger: {
      kind: 'task-state',
      description: 'Agent-assigned task enters todo/pending with valid context and no unresolved gate.',
    },
    dataSources: ['Projects/Kanban tasks', 'task comments', 'agentInput', 'dependencies', 'agent profile health'],
    allowedActions: ['read', 'task-release', 'report'],
    approvalGates: ['human-review'],
    evidenceRequirements: ['Task id/title', 'agent id', 'readiness reason', 'source context', 'completion artifact'],
    staleThreshold: '15 minutes for picked-up/in-progress heartbeat visibility',
    lastDecision: 'Run only when the task is explicitly eligible; explain why skipped otherwise.',
    whyItMatters: 'Turns Peet’s manual “why is this not moving?” checks into visible eligibility rules.',
  },
  {
    id: 'dependency-release',
    name: 'Safe Dependency Release Loop',
    status: 'guarded',
    ownerAgentId: 'pip',
    reviewerAgentId: 'nora',
    riskLevel: 'high',
    trigger: {
      kind: 'event',
      description: 'A dependency task reaches done/review-approved and downstream work is sequencing-only.',
    },
    dataSources: ['dependsOn', 'reviewStatus', 'agentStatus', 'approvalGateTaskId', 'task comments'],
    allowedActions: ['read', 'task-release', 'report'],
    approvalGates: ['client-visible', 'public-publishing', 'paid-spend', 'production-deploy', 'finance', 'secret-config', 'destructive-data'],
    evidenceRequirements: ['Resolved dependency ids', 'risk/capability classification', 'approval gate decision when required'],
    staleThreshold: '15 minutes after dependency resolution',
    lastDecision: 'Auto-release sequencing work only; keep approval-sensitive work awaiting input.',
    whyItMatters: 'Prevents both stuck dependency chains and accidental approval bypass.',
  },
  {
    id: 'review-pileup',
    name: 'Review Pileup Loop',
    status: 'active',
    ownerAgentId: 'pip',
    reviewerAgentId: 'nora',
    riskLevel: 'medium',
    trigger: {
      kind: 'cron',
      description: 'Review/done agent outputs exceed threshold or stay unreviewed beyond the stale window.',
    },
    dataSources: ['Projects/Kanban review column', 'agentOutput artifacts', 'task comments', 'briefing cards'],
    allowedActions: ['read', 'task-review', 'report'],
    approvalGates: ['human-review'],
    evidenceRequirements: ['Review queue counts', 'oldest item', 'owner/reviewer', 'recommended triage action'],
    staleThreshold: '24 hours for normal work, 4 hours for urgent/high-priority work',
    lastDecision: 'Summarize and route review work; do not mark final done without reviewer evidence.',
    whyItMatters: 'Keeps agent outputs from silently piling up after “done means ready for review.”',
  },
  {
    id: 'approval-gate',
    name: 'Client Approval Gate Loop',
    status: 'guarded',
    ownerAgentId: 'pip',
    reviewerAgentId: 'nora',
    riskLevel: 'critical',
    trigger: {
      kind: 'manual-review',
      description: 'A task requests client-visible, spend, production, finance, secret/config, or destructive action.',
    },
    dataSources: ['approvalGateTaskId', 'client documents', 'task comments', 'briefing cards', 'evidence ledger'],
    allowedActions: ['read', 'draft', 'report'],
    approvalGates: ['client-visible', 'public-publishing', 'paid-spend', 'production-deploy', 'finance', 'secret-config', 'destructive-data'],
    evidenceRequirements: ['Explicit approver', 'approval wording/scope', 'source id/version/comment', 'rollback or stop condition'],
    staleThreshold: 'Never auto-release purely by age',
    lastDecision: 'Prepare drafts/evidence only until explicit approval is recorded.',
    whyItMatters: 'Makes approval boundaries part of the workflow instead of a hidden policy memory.',
  },
  {
    id: 'seo-to-crm-acquisition',
    name: 'SEO-to-CRM Acquisition Loop',
    status: 'planned',
    ownerAgentId: 'seo',
    reviewerAgentId: 'sales',
    riskLevel: 'high',
    trigger: {
      kind: 'signal',
      description: 'SEO/content signal indicates pipeline opportunity, stale source attribution, or conversion gap.',
    },
    dataSources: ['SEO sprints', 'capture sources', 'CRM contacts', 'deals', 'reports/pipeline'],
    allowedActions: ['read', 'draft', 'task-create', 'report'],
    approvalGates: ['client-visible', 'public-publishing'],
    evidenceRequirements: ['Page/keyword/source link', 'CRM contact/deal link', 'pipeline impact hypothesis', 'recommended next task'],
    staleThreshold: 'Weekly until attribution is reliable; daily only for approved acquisition sprints',
    lastDecision: 'Prioritize by pipeline evidence, not impressions alone.',
    whyItMatters: 'Connects Silas SEO work and Blake sales outcomes into one acquisition feedback loop.',
  },
  {
    id: 'lead-response',
    name: 'Lead Response Loop',
    status: 'planned',
    ownerAgentId: 'sales',
    reviewerAgentId: 'nora',
    riskLevel: 'critical',
    trigger: {
      kind: 'event',
      description: 'New form submission, contact, reply, or high-intent CRM signal arrives.',
    },
    dataSources: ['forms', 'CRM contacts', 'capture sources', 'mailbox messages', 'sequence status'],
    allowedActions: ['read', 'draft', 'task-create', 'message-draft', 'report'],
    approvalGates: ['client-visible', 'secret-config'],
    evidenceRequirements: ['Lead source', 'suppression/duplicate check', 'draft follow-up', 'owner assignment', 'approval before send'],
    staleThreshold: '15 minutes for hot leads after approved operating scope',
    lastDecision: 'Create/draft immediately, but never send externally without the controlled-send approval gate.',
    whyItMatters: 'Improves speed-to-lead while preserving Nora’s governance controls.',
  },
]

export function getLoopById(id: string): LoopRegistryEntry | null {
  return LOOP_REGISTRY.find((loop) => loop.id === id) ?? null
}

export function loopsByStatus(status: LoopRegistryEntry['status']): LoopRegistryEntry[] {
  return LOOP_REGISTRY.filter((loop) => loop.status === status)
}

export function loopsRequiringApprovalGate(gate: LoopApprovalGate): LoopRegistryEntry[] {
  return LOOP_REGISTRY.filter((loop) => loop.approvalGates.includes(gate))
}
