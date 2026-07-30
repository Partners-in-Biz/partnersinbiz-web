import type { AgentId } from '@/lib/agents/types'

export type WorkforceBlueprintId =
  | 'executive'
  | 'sales'
  | 'marketing'
  | 'project_delivery'
  | 'customer_support'
  | 'finance'
  | 'people'
  | 'operations'
  | 'general'

export interface WorkforceSpecialistGap {
  id: 'finance_specialist' | 'people_specialist'
  label: string
  reason: string
}

export interface WorkforceBlueprint {
  id: WorkforceBlueprintId
  label: string
  summary: string
  recommendedAgentIds: AgentId[]
  requiredSkillIds: string[]
  onboardingChecks: string[]
  specialistGaps: WorkforceSpecialistGap[]
}

export type WorkforceBlueprintMatchSource = 'department' | 'job_title' | 'default'

export interface WorkforceBlueprintMatch {
  blueprint: WorkforceBlueprint
  source: WorkforceBlueprintMatchSource
}

function blueprint(input: WorkforceBlueprint): WorkforceBlueprint {
  return input
}

export const WORKFORCE_BLUEPRINTS: Record<WorkforceBlueprintId, WorkforceBlueprint> = {
  executive: blueprint({
    id: 'executive',
    label: 'Executive and owner',
    summary: 'Cross-business orchestration, decisions, reporting, approvals, and operational follow-through.',
    recommendedAgentIds: ['pip', 'data', 'nora'],
    requiredSkillIds: ['ceo-on-demand-gather', 'project-management', 'data-analyst', 'reports', 'billing-finance'],
    onboardingChecks: ['Confirm approval authority', 'Connect reporting sources', 'Choose permitted runtime targets'],
    specialistGaps: [],
  }),
  sales: blueprint({
    id: 'sales',
    label: 'Sales',
    summary: 'Pipeline execution, prospect research, outreach drafts, proposals, follow-ups, and CRM hygiene.',
    recommendedAgentIds: ['sales', 'pip', 'docs'],
    requiredSkillIds: ['sales-operating-system', 'crm-sales', 'email-outreach', 'client-documents', 'research-intelligence'],
    onboardingChecks: ['Confirm CRM scope', 'Confirm outreach approval policy', 'Connect mailbox and calendar when authorised'],
    specialistGaps: [],
  }),
  marketing: blueprint({
    id: 'marketing',
    label: 'Marketing',
    summary: 'Campaigns, content, social, paid media, SEO, analytics, and Studio production.',
    recommendedAgentIds: ['maya', 'ads', 'seo', 'data'],
    requiredSkillIds: ['content-engine', 'social-media-manager', 'ads-manager', 'seo-sprint-manager', 'analytics'],
    onboardingChecks: ['Confirm brand sources', 'Connect approved channels', 'Confirm publish and spend approvals'],
    specialistGaps: [],
  }),
  project_delivery: blueprint({
    id: 'project_delivery',
    label: 'Project delivery',
    summary: 'Planning, implementation, task orchestration, quality assurance, release evidence, and documentation.',
    recommendedAgentIds: ['pip', 'theo', 'qa-release', 'docs'],
    requiredSkillIds: ['interactive-project-planning', 'project-management', 'qa-release', 'docs-lead', 'evidence-ledger'],
    onboardingChecks: ['Select project workspaces', 'Confirm code/runtime access', 'Confirm release approval boundary'],
    specialistGaps: [],
  }),
  customer_support: blueprint({
    id: 'customer_support',
    label: 'Customer support',
    summary: 'Customer triage, CRM history, knowledge, response drafts, escalation, and follow-through.',
    recommendedAgentIds: ['support', 'nora', 'docs'],
    requiredSkillIds: ['support-manager', 'crm-sales', 'client-documents', 'email-outreach', 'evidence-ledger'],
    onboardingChecks: ['Connect support channels', 'Confirm client-message approval policy', 'Set escalation owners'],
    specialistGaps: [],
  }),
  finance: blueprint({
    id: 'finance',
    label: 'Finance',
    summary: 'Invoicing, accounting operations, payroll preparation, reporting, reconciliation, and controlled approvals.',
    recommendedAgentIds: ['nora', 'data', 'pip'],
    requiredSkillIds: ['billing-finance', 'reports', 'data-analyst', 'evidence-ledger', 'project-management'],
    onboardingChecks: ['Classify finance access', 'Confirm approval limits', 'Select legal entities and books', 'Review payroll privacy'],
    specialistGaps: [{
      id: 'finance_specialist',
      label: 'Dedicated Finance specialist',
      reason: 'Finance is currently covered by Nora, Data, and Pip; a dedicated governed Finance agent is still required.',
    }],
  }),
  people: blueprint({
    id: 'people',
    label: 'People and HR',
    summary: 'Onboarding, policies, leave, reviews, private people records, and controlled employee workflows.',
    recommendedAgentIds: ['docs', 'nora', 'pip'],
    requiredSkillIds: ['client-documents', 'docs-lead', 'project-management', 'evidence-ledger', 'system-auth'],
    onboardingChecks: ['Classify people data', 'Confirm record retention', 'Set private access groups', 'Confirm employment-law review'],
    specialistGaps: [{
      id: 'people_specialist',
      label: 'Dedicated People specialist',
      reason: 'People work is currently covered by Docs, Nora, and Pip; a dedicated privacy-governed People agent is still required.',
    }],
  }),
  operations: blueprint({
    id: 'operations',
    label: 'Operations',
    summary: 'Recurring work, process control, inbox and calendar operations, projects, reporting, and blocker follow-up.',
    recommendedAgentIds: ['nora', 'pip', 'data'],
    requiredSkillIds: ['daily-workflow', 'project-management', 'reports', 'data-analyst', 'google-workspace'],
    onboardingChecks: ['Confirm operational systems', 'Choose permitted runtime targets', 'Set approval and escalation owners'],
    specialistGaps: [],
  }),
  general: blueprint({
    id: 'general',
    label: 'General business',
    summary: 'General orchestration, operational follow-through, documents, and routing to the right specialist.',
    recommendedAgentIds: ['pip', 'nora', 'docs'],
    requiredSkillIds: ['client-manager', 'project-management', 'daily-workflow', 'client-documents', 'evidence-ledger'],
    onboardingChecks: ['Add department and job title for a tailored team', 'Choose permitted runtime targets'],
    specialistGaps: [],
  }),
}

const ROLE_PATTERNS: Array<{ id: WorkforceBlueprintId; pattern: RegExp }> = [
  { id: 'people', pattern: /\b(?:hr|human resources|people|talent|recruit(?:er|ing|ment)?|employee|culture)\b/i },
  { id: 'finance', pattern: /\b(?:finance|financial|account(?:ant|ing|s)?|bookkeep(?:er|ing)?|payroll|cfo|tax|treasury)\b/i },
  { id: 'sales', pattern: /\b(?:sales|revenue|business development|partnerships?|account executive|commercial|growth executive)\b/i },
  { id: 'marketing', pattern: /\b(?:marketing|brand|content|social media|advertising|paid media|seo|communications?|creative)\b/i },
  { id: 'customer_support', pattern: /\b(?:customer support|customer service|client service|help ?desk|support|success manager)\b/i },
  { id: 'project_delivery', pattern: /\b(?:project|delivery|engineering|engineer|developer|development|product|technical|technology|qa|quality assurance|implementation)\b/i },
  { id: 'operations', pattern: /\b(?:operations?|office manager|administrator|administration|procurement|logistics|facilities)\b/i },
  { id: 'executive', pattern: /\b(?:owner|founder|chief executive|ceo|managing director|executive|director|leadership)\b/i },
]

function matchValue(value: string | null | undefined): WorkforceBlueprintId | null {
  const normalized = value?.trim()
  if (!normalized) return null
  return ROLE_PATTERNS.find((candidate) => candidate.pattern.test(normalized))?.id ?? null
}

export function resolveWorkforceBlueprint(input: {
  department?: string | null
  jobTitle?: string | null
}): WorkforceBlueprintMatch {
  const departmentMatch = matchValue(input.department)
  if (departmentMatch) return { blueprint: WORKFORCE_BLUEPRINTS[departmentMatch], source: 'department' }
  const titleMatch = matchValue(input.jobTitle)
  if (titleMatch) return { blueprint: WORKFORCE_BLUEPRINTS[titleMatch], source: 'job_title' }
  return { blueprint: WORKFORCE_BLUEPRINTS.general, source: 'default' }
}
