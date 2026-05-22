import type { AgentId, AgentRegistryEntry } from './types'
import { getAgentSkillPolicy } from './skill-policy'

const REGISTRY_KEYS = [
  'responsibilities',
  'skills',
  'cronWatchLoops',
  'allowedScopes',
  'exampleTaskTypes',
] as const

type RegistryKey = (typeof REGISTRY_KEYS)[number]

export const AGENT_REGISTRY: Record<string, AgentRegistryEntry> = {
  pip: {
    responsibilities: [
      'Front-door operator for Partners in Biz client requests',
      'Resolve client context, route work to the right specialist, and keep Projects/Kanban audit trails current',
      'Coordinate cross-module work across social, SEO, CRM, billing, documents, properties, and platform operations',
    ],
    skills: [
      'partnersinbiz/client-manager',
      'partnersinbiz/project-management',
      'partnersinbiz/platform-ops',
      'partnersinbiz/social-media-manager',
      'partnersinbiz/seo-sprint-manager',
      'partnersinbiz/content-engine',
    ],
    cronWatchLoops: [
      'Kanban/task dispatch pickup and completion loops',
      'Client and platform hot-cache hygiene checks',
      'Cross-agent blocker and approval-gate follow-up',
    ],
    allowedScopes: [
      'all-client-workspaces',
      'platform-admin-api',
      'project-kanban-routing',
      'obsidian-client-wiki',
      'agent-profile-orchestration',
    ],
    exampleTaskTypes: [
      'Route a vague client request to the correct workstream',
      'Create an approval-gated project plan and specialist task chain',
      'Summarize multi-agent progress for Peet with evidence links',
    ],
  },
  theo: {
    responsibilities: [
      'Full-stack engineering for Partners in Biz and client web properties',
      'Implement tested platform features, integrations, migrations, and deployment fixes',
      'Keep development work on the development branch with focused commits and preview-safe changes',
    ],
    skills: [
      'software-development/test-driven-development',
      'software-development/systematic-debugging',
      'github/github-pr-workflow',
      'partnersinbiz/platform-ops',
      'partnersinbiz/client-manager',
    ],
    cronWatchLoops: [
      'Kanban engineering task pickup',
      'Preview build and failing-test follow-up where assigned',
      'Repository hygiene and blocked-branch escalation',
    ],
    allowedScopes: [
      'partnersinbiz-web-development',
      'client-codebases-when-assigned',
      'github-development-branches',
      'test-and-build-artifacts',
    ],
    exampleTaskTypes: [
      'Build an API route with tests',
      'Fix a regression from CI evidence',
      'Wire a new admin UI surface to Firestore/API data',
    ],
  },
  maya: {
    responsibilities: [
      'Creative content, campaign, and brand execution for PiB clients',
      'Draft, schedule, and review social/content assets using client brand context',
      'Turn briefs into audience-appropriate copy, visuals, and campaign calendars',
    ],
    skills: [
      'partnersinbiz/content-engine',
      'partnersinbiz/social-media-manager',
      'partnersinbiz/client-documents',
      'creative/humanizer',
      'media/youtube-content',
    ],
    cronWatchLoops: [
      'Campaign content queue review',
      'Scheduled-post readiness and approval follow-up',
      'Brand/source-material refresh checks',
    ],
    allowedScopes: [
      'content-drafts',
      'social-campaigns',
      'client-brand-wikis',
      'client-facing-documents-when-assigned',
    ],
    exampleTaskTypes: [
      'Create a month of LinkedIn post drafts from a client brief',
      'Rewrite AI-ish copy into the client voice',
      'Prepare a campaign review pack for approval',
    ],
  },
  sage: {
    responsibilities: [
      'Research, analysis, SEO intelligence, and competitive reconnaissance',
      'Gather evidence, synthesize findings, and recommend measurable next actions',
      'Maintain source-backed research notes for client and platform decisions',
    ],
    skills: [
      'research/blogwatcher',
      'productivity/maps',
      'partnersinbiz/analytics',
      'partnersinbiz/seo-sprint-manager',
      'note-taking/obsidian',
    ],
    cronWatchLoops: [
      'SEO sprint monitoring and opportunity discovery',
      'Competitor/content feed watch loops when configured',
      'Analytics anomaly and research-source freshness checks',
    ],
    allowedScopes: [
      'public-web-research',
      'analytics-readouts',
      'seo-sprints',
      'client-research-wiki',
      'non-mutating-api-reads-by-default',
    ],
    exampleTaskTypes: [
      'Research competitors and produce a ranked opportunity list',
      'Diagnose SEO sprint performance from Search Console data',
      'Build a source-backed market brief for a client proposal',
    ],
  },
  nora: {
    responsibilities: [
      'Back-office operations across CRM, billing, finance, reporting, and admin follow-through',
      'Keep operational records tidy, reconciled, and linked back to Projects/Kanban where needed',
      'Escalate human approvals, missing information, and finance-sensitive blockers clearly',
    ],
    skills: [
      'partnersinbiz/billing-finance',
      'partnersinbiz/crm-sales',
      'partnersinbiz/project-management',
      'partnersinbiz/email-outreach',
      'productivity/google-workspace',
    ],
    cronWatchLoops: [
      'Overdue task, invoice, and follow-up reminders',
      'CRM hygiene and stale-deal checks',
      'Time-entry and billing reconciliation where configured',
    ],
    allowedScopes: [
      'billing-and-invoices',
      'crm-records',
      'project-admin',
      'calendar-and-email-ops-when-authorized',
      'reports',
    ],
    exampleTaskTypes: [
      'Prepare an invoice follow-up list',
      'Clean up CRM records after a campaign handoff',
      'Create operational blocker tasks with exact required evidence',
    ],
  },
}

export function getAgentRegistryEntry(agentId: AgentId): AgentRegistryEntry | undefined {
  return AGENT_REGISTRY[agentId]
}

function stringArrayFrom(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const clean = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
  return clean.length > 0 ? clean : undefined
}

export function normalizeAgentRegistryInput(input: unknown): Partial<AgentRegistryEntry> {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const normalized: Partial<AgentRegistryEntry> = {}

  for (const key of REGISTRY_KEYS) {
    const value = stringArrayFrom(source[key])
    if (value) normalized[key as RegistryKey] = value
  }

  return normalized
}

export function mergeAgentRegistry(agentId: AgentId, stored?: Partial<AgentRegistryEntry> | null): AgentRegistryEntry {
  const defaults = getAgentRegistryEntry(agentId)
  const safeStored = normalizeAgentRegistryInput(stored)
  const policy = getAgentSkillPolicy(agentId)
  const policySkills = policy
    ? [
        ...policy.pibSkills.map((skill) => `partnersinbiz/${skill}`),
        ...policy.globalSkills,
      ]
    : undefined
  return {
    responsibilities: safeStored.responsibilities ?? defaults?.responsibilities ?? [],
    skills: safeStored.skills ?? policySkills ?? defaults?.skills ?? [],
    cronWatchLoops: safeStored.cronWatchLoops ?? defaults?.cronWatchLoops ?? [],
    allowedScopes: safeStored.allowedScopes ?? defaults?.allowedScopes ?? [],
    exampleTaskTypes: safeStored.exampleTaskTypes ?? defaults?.exampleTaskTypes ?? [],
  }
}
