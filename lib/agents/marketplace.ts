/**
 * Agent marketplace — public templates that members can pull to their own
 * computers without receiving Partners in Biz tenant/ops skill packs or the
 * ability to edit system (platform) agents.
 *
 * Marketplace instance ids: `mp-{templateId}-{12hex}` e.g. `mp-pip-a1b2c3d4e5f6`
 * Platform ids (`pip`, `theo`, …) remain super-admin only.
 */
import crypto from 'node:crypto'
import type { OrgRole } from '@/lib/organizations/types'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import { assertCanCreateAgentOnDevice } from '@/lib/agents/org-agent-policy'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

export const MARKETPLACE_PACK_VERSION = 'marketplace-public-v1'

export type MarketplaceTemplateId =
  | 'pip'
  | 'theo'
  | 'maya'
  | 'sage'
  | 'nora'
  | 'docs'
  | 'data'
  | 'seo'
  | 'sales'
  | 'support'
  | 'ads'
  | 'qa-release'

export type MarketplaceTemplate = {
  templateId: MarketplaceTemplateId
  name: string
  role: string
  /** Public persona only — no PiB client/ops instructions. */
  publicPersona: string
  iconKey: string
  colorKey: string
  /** Skills shipped on pull. Must exist under packs/pib-system-skills/skills. */
  publicSkills: string[]
  /** Short marketplace blurb. */
  summary: string
}

/**
 * Conservative public skill allowlist. Intentionally excludes CRM, client docs,
 * CEO gatherers, finance, social publishing, and other PiB-operating skills.
 */
const CORE_PUBLIC = [
  'project-management',
  'collaboration-runtime',
  'evidence-ledger',
  'daily-workflow',
  'interactive-project-planning',
] as const

const RESEARCH_PUBLIC = [
  'research-intelligence',
  'data-analyst',
  'evidence-ledger',
  'collaboration-runtime',
] as const

const CONTENT_PUBLIC = [
  'content-engine',
  'research-intelligence',
  'collaboration-runtime',
  'evidence-ledger',
] as const

const MARKETPLACE_TEMPLATES: MarketplaceTemplate[] = [
  {
    templateId: 'pip',
    name: 'Pip',
    role: 'Orchestrator',
    summary: 'Coordinates work, planning, and multi-step project execution.',
    publicPersona:
      'You are Pip, a generalist project orchestrator. Help the user plan work, break down tasks, track progress, and keep evidence organised. Do not assume Partners in Biz internal policies, client lists, or admin access. Use only the skills installed on this profile and the user\'s own credentials.',
    iconKey: 'smart_toy',
    colorKey: 'sky',
    publicSkills: [...CORE_PUBLIC],
  },
  {
    templateId: 'theo',
    name: 'Theo',
    role: 'Engineer',
    summary: 'Software engineering, debugging, and implementation support.',
    publicPersona:
      'You are Theo, a careful software engineer. Prefer small verified changes, tests, and clear evidence. Do not assume access to Partners in Biz production systems or internal agent fleets. Use only the skills and credentials available on this computer.',
    iconKey: 'code',
    colorKey: 'violet',
    publicSkills: [...CORE_PUBLIC, 'platform-ops'],
  },
  {
    templateId: 'maya',
    name: 'Maya',
    role: 'Marketing',
    summary: 'Content and marketing drafting without live publishing rights.',
    publicPersona:
      'You are Maya, a marketing and content specialist. Draft campaigns, content plans, and copy. Do not publish to client channels or spend ad budget unless the user explicitly provides those tools and approvals in this workspace.',
    iconKey: 'campaign',
    colorKey: 'rose',
    publicSkills: [...CONTENT_PUBLIC],
  },
  {
    templateId: 'sage',
    name: 'Sage',
    role: 'Research',
    summary: 'Research, analysis, and structured findings.',
    publicPersona:
      'You are Sage, a research analyst. Produce structured findings with sources and evidence. Do not invent access to proprietary Partners in Biz client data.',
    iconKey: 'psychology',
    colorKey: 'amber',
    publicSkills: [...RESEARCH_PUBLIC, 'project-management'],
  },
  {
    templateId: 'nora',
    name: 'Nora',
    role: 'Operations',
    summary: 'Operations hygiene, checklists, and process support.',
    publicPersona:
      'You are Nora, an operations assistant. Help with checklists, process design, and operational clarity. Stay within the tools available on this profile.',
    iconKey: 'assignment',
    colorKey: 'emerald',
    publicSkills: [...CORE_PUBLIC, 'data-analyst'],
  },
  {
    templateId: 'docs',
    name: 'Docs',
    role: 'Documentation',
    summary: 'Specs, proposals, and documentation drafting.',
    publicPersona:
      'You are Docs, a documentation specialist. Draft clear specs, proposals, and handoffs. Do not treat internal Partners in Biz document APIs as available unless the user\'s environment provides them.',
    iconKey: 'description',
    colorKey: 'cyan',
    publicSkills: [...CORE_PUBLIC, 'content-engine', 'research-intelligence'],
  },
  {
    templateId: 'data',
    name: 'Data',
    role: 'Data analyst',
    summary: 'Analytics framing and data interpretation.',
    publicPersona:
      'You are Data, an analyst. Help interpret metrics, design queries, and explain results. Do not invent live database access.',
    iconKey: 'analytics',
    colorKey: 'indigo',
    publicSkills: [...RESEARCH_PUBLIC, 'project-management'],
  },
  {
    templateId: 'seo',
    name: 'SEO',
    role: 'SEO specialist',
    summary: 'SEO planning and content guidance (no live CMS publish by default).',
    publicPersona:
      'You are an SEO specialist. Produce keyword plans, content briefs, and technical SEO checklists. Do not assume live site deploy credentials.',
    iconKey: 'travel_explore',
    colorKey: 'teal',
    publicSkills: [...CONTENT_PUBLIC, 'project-management'],
  },
  {
    templateId: 'sales',
    name: 'Sales',
    role: 'Sales assistant',
    summary: 'Sales messaging and pipeline coaching without CRM write access by default.',
    publicPersona:
      'You are a sales assistant. Help with outreach messaging, discovery questions, and deal strategy. Do not assume CRM admin access or client lists from Partners in Biz.',
    iconKey: 'handshake',
    colorKey: 'orange',
    publicSkills: [...CORE_PUBLIC, 'research-intelligence', 'content-engine'],
  },
  {
    templateId: 'support',
    name: 'Support',
    role: 'Support specialist',
    summary: 'Support triage patterns and response drafting.',
    publicPersona:
      'You are a support specialist. Help triage issues, draft replies, and structure reproduction steps. Do not assume access to production support queues.',
    iconKey: 'support_agent',
    colorKey: 'slate',
    publicSkills: [...CORE_PUBLIC, 'research-intelligence'],
  },
  {
    templateId: 'ads',
    name: 'Ads',
    role: 'Ads strategist',
    summary: 'Paid media planning (no spend execution by default).',
    publicPersona:
      'You are an ads strategist. Help with campaign structure, creative briefs, and measurement plans. Never initiate paid spend without explicit tools and human approval.',
    iconKey: 'ads_click',
    colorKey: 'rose',
    publicSkills: [...CONTENT_PUBLIC, 'data-analyst', 'project-management'],
  },
  {
    templateId: 'qa-release',
    name: 'QA Release',
    role: 'QA / release',
    summary: 'Test plans, release checks, and verification discipline.',
    publicPersona:
      'You are a QA and release specialist. Design test plans, verification checklists, and release readiness reviews. Prefer evidence over claims.',
    iconKey: 'verified',
    colorKey: 'emerald',
    publicSkills: [...CORE_PUBLIC, 'platform-ops', 'data-analyst'],
  },
]

const TEMPLATES_BY_ID = new Map(MARKETPLACE_TEMPLATES.map((row) => [row.templateId, row]))

/** Longest template ids first so `qa-release` wins over partial matches. */
const TEMPLATE_IDS_LONGEST_FIRST = [...TEMPLATES_BY_ID.keys()].sort((a, b) => b.length - a.length)

export function listMarketplaceTemplates(): MarketplaceTemplate[] {
  return MARKETPLACE_TEMPLATES.map((row) => ({
    ...row,
    publicSkills: [...row.publicSkills],
  }))
}

export function getMarketplaceTemplate(templateId: string): MarketplaceTemplate | null {
  return TEMPLATES_BY_ID.get(templateId as MarketplaceTemplateId) ?? null
}

export function isMarketplaceTemplateId(value: unknown): value is MarketplaceTemplateId {
  return typeof value === 'string' && TEMPLATES_BY_ID.has(value as MarketplaceTemplateId)
}

/**
 * Stable marketplace instance id for a scope (user or org) + template.
 * Never collides with platform `pip` / `theo` ids.
 */
export function buildMarketplaceAgentId(input: {
  templateId: MarketplaceTemplateId
  scope: 'user' | 'org'
  scopeId: string
}): AgentId {
  if (!TEMPLATES_BY_ID.has(input.templateId)) {
    throw new Error(`Unknown marketplace template: ${input.templateId}`)
  }
  const material = `${input.scope}:${input.scopeId}:template:${input.templateId}`
  const key = crypto.createHash('sha256').update(material).digest('hex').slice(0, 12)
  const agentId = `mp-${input.templateId}-${key}`
  if (!isValidAgentId(agentId)) {
    throw new Error(`Marketplace agent id failed validation: ${agentId}`)
  }
  return agentId
}

export function parseMarketplaceAgentId(agentId: string): {
  templateId: MarketplaceTemplateId
  scopeKey: string
} | null {
  if (!agentId.startsWith('mp-')) return null
  const rest = agentId.slice(3)
  for (const templateId of TEMPLATE_IDS_LONGEST_FIRST) {
    const prefix = `${templateId}-`
    if (!rest.startsWith(prefix)) continue
    const scopeKey = rest.slice(prefix.length)
    if (!/^[a-f0-9]{12}$/.test(scopeKey)) continue
    return { templateId, scopeKey }
  }
  return null
}

export function isMarketplaceAgentId(agentId: string): boolean {
  return parseMarketplaceAgentId(agentId) !== null
}

/** Public skills for a marketplace instance or template id. Empty for non-marketplace. */
export function marketplacePublicSkillsForAgent(agentId: string): string[] {
  const parsed = parseMarketplaceAgentId(agentId)
  if (!parsed) return []
  const template = getMarketplaceTemplate(parsed.templateId)
  return template ? [...template.publicSkills] : []
}

export function marketplacePolicyVersion(): string {
  return MARKETPLACE_PACK_VERSION
}

export function resolveMarketplacePullScope(input: {
  device: Pick<LinkedDevice, 'ownerType' | 'ownerUserId' | 'ownerOrgId' | 'status'>
  actorUserId: string
  orgId: string
  role: OrgRole
}): { scope: 'user' | 'org'; scopeId: string; accessScope: 'personal' | 'organization' } {
  const accessScope = assertCanCreateAgentOnDevice({
    device: input.device,
    actorUserId: input.actorUserId,
    orgId: input.orgId,
    role: input.role,
  })
  if (accessScope === 'personal') {
    return { scope: 'user', scopeId: input.actorUserId, accessScope: 'personal' }
  }
  return { scope: 'org', scopeId: input.orgId, accessScope: 'organization' }
}
