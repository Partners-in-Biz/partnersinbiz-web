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
  loopContract: {
    inputState: string
    verificationSignals: string[]
    stopCondition: string
    maxIterations: number
    budgetGuardrail: string
    noProgressPolicy: string
    escalationPath: string
  }
  positioning: {
    internalValue: string
    buyerValue: string
  }
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
    loopContract: {
      inputState: 'Eligible Projects/Kanban agent tasks plus recent comments, dependencies, and profile health.',
      verificationSignals: ['Task entered picked-up/in-progress', 'Agent heartbeat or run id recorded', 'Completion artifact or blocker comment exists'],
      stopCondition: 'Stop when the task is dispatched, blocked with a reason, or no longer eligible.',
      maxIterations: 2,
      budgetGuardrail: 'One readiness evaluation plus one dispatch/report action per task per watcher tick.',
      noProgressPolicy: 'Escalate after a stale heartbeat or repeated eligibility failure with the same reason.',
      escalationPath: 'Pip summarizes the blocker for Peet or Quinn/Nora depending on review vs ops ownership.',
    },
    positioning: {
      internalValue: 'Follow-through visibility for internal agent work.',
      buyerValue: 'Client work keeps moving because every handoff has an owner, proof, and a stop rule.',
    },
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
    loopContract: {
      inputState: 'Resolved upstream dependencies, downstream tasks, approval gate metadata, and recent review comments.',
      verificationSignals: ['All dependency ids resolved', 'Downstream task remains internal/sequencing-only', 'Approval-sensitive capabilities remain gated'],
      stopCondition: 'Stop after releasing sequencing-only work or recording an approval blocker.',
      maxIterations: 1,
      budgetGuardrail: 'Single dependency-release decision per downstream task after a dependency state change.',
      noProgressPolicy: 'If a downstream task remains gated for the same reason, report it once instead of repeatedly requeueing.',
      escalationPath: 'Pip routes sequencing blockers to Nora and implementation blockers to the owning specialist.',
    },
    positioning: {
      internalValue: 'Prevents dependency chains from stalling or bypassing gates.',
      buyerValue: 'Projects advance predictably without letting automation skip approvals.',
    },
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
    loopContract: {
      inputState: 'Review-column tasks, done agent outputs, artifacts, reviewStatus, and briefing cards.',
      verificationSignals: ['Review item surfaced to owner', 'Reviewer comment or approval recorded', 'Oldest-pending age decreases'],
      stopCondition: 'Stop when review is routed, approved, changes-requested, or escalated.',
      maxIterations: 3,
      budgetGuardrail: 'Summarize batches rather than reprocessing every old card individually.',
      noProgressPolicy: 'Escalate no-op streaks when the same oldest review item stays unchanged across runs.',
      escalationPath: 'Nora handles ops review pileups; Quinn handles QA/release-review pileups.',
    },
    positioning: {
      internalValue: 'Turns finished agent work into reviewable decisions instead of silent backlog.',
      buyerValue: 'Outputs do not disappear after an AI says done; a human-readable review trail remains.',
    },
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
    loopContract: {
      inputState: 'Approval gate task, source document/version/comment, requested action, risk class, and approver evidence.',
      verificationSignals: ['Explicit approval wording exists', 'Scope matches the requested action', 'Rollback or stop condition is captured'],
      stopCondition: 'Stop when approval is recorded, rejected, expired, or escalated for missing scope.',
      maxIterations: 1,
      budgetGuardrail: 'Never retry approval interpretation as an autonomous action; require explicit evidence.',
      noProgressPolicy: 'Keep the gate awaiting input and surface the exact missing evidence, not repeated agent attempts.',
      escalationPath: 'Nora/Pip summarize missing approval evidence for Peet; Quinn reviews release-sensitive gates.',
    },
    positioning: {
      internalValue: 'Makes approvals auditable rather than implied.',
      buyerValue: 'Governed automation: fast preparation, human control at risky moments.',
    },
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
    loopContract: {
      inputState: 'SEO sprint signals, page/source evidence, CRM company/contact/deal links, and pipeline report context.',
      verificationSignals: ['SEO signal has source evidence', 'CRM handoff target exists or missing field is named', 'Recommended sales task has an owner'],
      stopCondition: 'Stop after producing a readiness report or internal sales/research task.',
      maxIterations: 2,
      budgetGuardrail: 'Do not run daily commercial loop expansion without approved acquisition sprint scope.',
      noProgressPolicy: 'If attribution evidence is still missing, record the missing field once and route to data/SEO.',
      escalationPath: 'Silas owns SEO proof, Blake owns CRM/sales handoff, Vera owns attribution gaps.',
    },
    positioning: {
      internalValue: 'Connects SEO observations to sales follow-through with evidence.',
      buyerValue: 'Growth loops turn traffic signals into qualified next actions, not vanity metrics.',
    },
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
    loopContract: {
      inputState: 'New lead/reply signal, CRM duplicate/suppression state, source context, mailbox/sequence status, and approved operating scope.',
      verificationSignals: ['Internal owner task created', 'Draft response exists when appropriate', 'Suppression/duplicate check recorded', 'No external send without approval'],
      stopCondition: 'Stop after assigning the lead, drafting a response, or blocking on approval/suppression.',
      maxIterations: 2,
      budgetGuardrail: 'One task proposal and one draft proposal per lead per event; no autonomous send loop.',
      noProgressPolicy: 'Escalate if a hot lead remains unowned or draft-only beyond the approved speed-to-lead window.',
      escalationPath: 'Blake owns sales response, Nora owns controlled-send governance, Pip escalates missing approval.',
    },
    positioning: {
      internalValue: 'Improves speed-to-lead while preserving controlled-send gates.',
      buyerValue: 'Follow-through, not prompts: leads are captured, checked, assigned, and drafted with proof.',
    },
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
