/**
 * AgentOrgNode seed — default org chart for the Partners in Biz parent org
 * (pib-platform-owner). Shape optimised for a development + marketing company:
 *
 *   Pip (CEO / Coordinator) at the root.
 *   Engineering (Theo Lead Dev)
 *     → Theo FE, Theo BE (role seats until hired), Quinn (QA & Release)
 *   Marketing (Maya Lead)
 *     → Ari (Paid), Silas (SEO), Vera (Analytics)
 *   Direct reports to Pip: Sage (Research), Blake (Sales), Iris (Docs),
 *   Nora (Billing & Ops), Luca (Support)
 *
 * Idempotent: skips creation when the org already has nodes.
 * Live reshapes of an existing chart use /hire + pib-agent-org-setup (patch), not re-seed.
 */
import { DEFAULT_ORG_NODE_DELEGATION, type AgentOrgNode } from './types'
import { createOrgNode, listOrgNodes } from './store'
import { buildOrgTree, validateReparent } from './tree'
import { persistChains } from './store'
import type { AgentEffort, AgentModel } from '@/lib/agents/runRouting'

export interface SeedResult {
  ok: boolean
  created: number
  skipped: boolean
  error?: string
}

interface SeedSpec {
  id: string
  agentId: string | null
  name: string
  title: string
  reportsTo: string | null
  capabilities: string[]
  defaultModel?: AgentModel | null
  defaultEffort?: AgentEffort | null
  iconKey: string
  colorKey: string
  delegation: AgentOrgNode['delegation']
}

export function defaultOrgChartSeed(orgId: string): SeedSpec[] {
  const open: AgentOrgNode['delegation'] = { ...DEFAULT_ORG_NODE_DELEGATION, assignableFrom: 'anyone' }
  const managerOnly: AgentOrgNode['delegation'] = { ...DEFAULT_ORG_NODE_DELEGATION, assignableFrom: 'manager_only' }
  const peers: AgentOrgNode['delegation'] = { ...DEFAULT_ORG_NODE_DELEGATION, assignableFrom: 'manager_and_peers', allowLateral: true }

  void orgId
  return [
    {
      id: 'pip',
      agentId: 'pip',
      name: 'Pip',
      title: 'CEO · Coordinator',
      reportsTo: null,
      capabilities: ['routing', 'projects', 'approvals', 'client-context', 'cross-agent'],
      defaultModel: 'grok-4.6',
      defaultEffort: 'medium',
      iconKey: 'hub',
      colorKey: 'violet',
      delegation: open,
    },
    {
      id: 'theo',
      agentId: 'theo',
      name: 'Theo',
      title: 'VP Engineering · Lead Developer',
      reportsTo: 'pip',
      capabilities: ['engineering', 'architecture', 'deployments', 'infra', 'github', 'vercel'],
      defaultModel: 'grok-4.6',
      defaultEffort: 'high',
      iconKey: 'code',
      colorKey: 'sky',
      delegation: managerOnly,
    },
    {
      id: 'theo-fe',
      agentId: null,
      name: 'Theo FE',
      title: 'Frontend Engineer',
      reportsTo: 'theo',
      capabilities: ['frontend', 'react', 'nextjs', 'ui', 'tailwind', 'accessibility'],
      defaultModel: 'claude-sonnet-4-6',
      defaultEffort: 'medium',
      iconKey: 'palette',
      colorKey: 'indigo',
      delegation: managerOnly,
    },
    {
      id: 'theo-be',
      agentId: null,
      name: 'Theo BE',
      title: 'Backend Engineer',
      reportsTo: 'theo',
      capabilities: ['backend', 'apis', 'firestore', 'auth', 'database', 'devops'],
      defaultModel: 'gpt-5.5',
      defaultEffort: 'high',
      iconKey: 'dns',
      colorKey: 'emerald',
      delegation: managerOnly,
    },
    {
      id: 'qa-release',
      agentId: 'qa-release',
      name: 'Quinn',
      title: 'QA & Release Lead',
      reportsTo: 'theo',
      capabilities: ['qa', 'release-readiness', 'smoke-tests', 'production-verification', 'rollback'],
      defaultModel: 'gpt-5.4',
      defaultEffort: 'medium',
      iconKey: 'verified',
      colorKey: 'green',
      delegation: peers,
    },
    {
      id: 'maya',
      agentId: 'maya',
      name: 'Maya',
      title: 'VP Marketing · Content Engine',
      reportsTo: 'pip',
      capabilities: ['marketing-lead', 'content', 'social', 'brand-voice', 'campaigns', 'creative'],
      defaultModel: 'claude-sonnet-4-6',
      defaultEffort: 'medium',
      iconKey: 'edit',
      colorKey: 'pink',
      // Maya may assign to marketing reports + peer with research/sales when needed.
      delegation: { ...peers, assignableFrom: 'manager_and_peers', allowLateral: true },
    },
    {
      id: 'ads',
      agentId: 'ads',
      name: 'Ari',
      title: 'Paid Media Lead',
      reportsTo: 'maya',
      capabilities: ['paid-ads', 'media-planning', 'budgets', 'experiments', 'launch'],
      defaultModel: 'gpt-5.5',
      defaultEffort: 'high',
      iconKey: 'campaign',
      colorKey: 'rose',
      delegation: managerOnly,
    },
    {
      id: 'seo',
      agentId: 'seo',
      name: 'Silas',
      title: 'SEO Lead',
      reportsTo: 'maya',
      capabilities: ['seo', 'local-seo', 'gsc', 'pagespeed', 'bing', 'optimization'],
      defaultModel: 'gpt-5.4',
      defaultEffort: 'medium',
      iconKey: 'trending_up',
      colorKey: 'lime',
      delegation: managerOnly,
    },
    {
      id: 'data',
      agentId: 'data',
      name: 'Vera',
      title: 'Analytics & Growth Data',
      reportsTo: 'maya',
      capabilities: ['analytics', 'attribution', 'dashboards', 'reporting', 'data-quality'],
      defaultModel: 'gpt-5.5',
      defaultEffort: 'high',
      iconKey: 'query_stats',
      colorKey: 'purple',
      delegation: peers,
    },
    {
      id: 'sage',
      agentId: 'sage',
      name: 'Sage',
      title: 'Research & Intelligence',
      reportsTo: 'pip',
      capabilities: ['research', 'competitive-analysis', 'evidence', 'strategy', 'market-intel'],
      defaultModel: 'grok-4.6',
      defaultEffort: 'high',
      iconKey: 'search',
      colorKey: 'amber',
      delegation: peers,
    },
    {
      id: 'sales',
      agentId: 'sales',
      name: 'Blake',
      title: 'Sales Lead',
      reportsTo: 'pip',
      capabilities: ['leads', 'prospects', 'crm-pipeline', 'outreach', 'proposals', 'revenue'],
      defaultModel: 'gpt-5.5',
      defaultEffort: 'high',
      iconKey: 'sell',
      colorKey: 'orange',
      delegation: peers,
    },
    {
      id: 'docs',
      agentId: 'docs',
      name: 'Iris',
      title: 'Documents & Specs',
      reportsTo: 'pip',
      capabilities: ['documents', 'specs', 'approvals', 'reports', 'polish'],
      defaultModel: 'claude-sonnet-4-6',
      defaultEffort: 'medium',
      iconKey: 'description',
      colorKey: 'blue',
      delegation: peers,
    },
    {
      id: 'nora',
      agentId: 'nora',
      name: 'Nora',
      title: 'Billing & Operations',
      reportsTo: 'pip',
      capabilities: ['billing', 'invoices', 'crm-hygiene', 'reports', 'ops'],
      defaultModel: 'gpt-5.4-mini',
      defaultEffort: 'medium',
      iconKey: 'account_balance',
      colorKey: 'teal',
      delegation: peers,
    },
    {
      id: 'support',
      agentId: 'support',
      name: 'Luca',
      title: 'Client Support',
      reportsTo: 'pip',
      capabilities: ['support', 'triage', 'reproduction', 'routing', 'client-care'],
      defaultModel: 'gpt-5.4-mini',
      defaultEffort: 'medium',
      iconKey: 'headset',
      colorKey: 'cyan',
      delegation: peers,
    },
  ]
}

export type SeedTemplate = 'platform' | 'minimal'

/** Lightweight starter chart for client orgs (unbound seats — bind via portal/Pip skill). */
export function minimalOrgChartSeed(orgId: string): SeedSpec[] {
  void orgId
  const open: AgentOrgNode['delegation'] = { ...DEFAULT_ORG_NODE_DELEGATION, assignableFrom: 'anyone' }
  const managerOnly: AgentOrgNode['delegation'] = { ...DEFAULT_ORG_NODE_DELEGATION, assignableFrom: 'manager_only' }
  const peers: AgentOrgNode['delegation'] = {
    ...DEFAULT_ORG_NODE_DELEGATION,
    assignableFrom: 'manager_and_peers',
    allowLateral: true,
  }
  return [
    {
      id: 'coordinator',
      agentId: null,
      name: 'Coordinator',
      title: 'Org Coordinator',
      reportsTo: null,
      capabilities: ['routing', 'projects', 'approvals', 'client-context'],
      defaultModel: 'grok-4.6',
      defaultEffort: 'medium',
      iconKey: 'hub',
      colorKey: 'violet',
      delegation: open,
    },
    {
      id: 'delivery-lead',
      agentId: null,
      name: 'Delivery Lead',
      title: 'Development Lead',
      reportsTo: 'coordinator',
      capabilities: ['delivery', 'engineering', 'implementation', 'qa-handoff'],
      defaultModel: 'grok-4.6',
      defaultEffort: 'high',
      iconKey: 'engineering',
      colorKey: 'sky',
      delegation: peers,
    },
    {
      id: 'marketing-lead',
      agentId: null,
      name: 'Marketing Lead',
      title: 'Marketing Lead',
      reportsTo: 'coordinator',
      capabilities: ['marketing', 'content', 'social', 'brand-voice', 'campaigns'],
      defaultModel: 'claude-sonnet-4-6',
      defaultEffort: 'medium',
      iconKey: 'campaign',
      colorKey: 'pink',
      delegation: peers,
    },
    {
      id: 'content-lead',
      agentId: null,
      name: 'Content Lead',
      title: 'Content Specialist',
      reportsTo: 'marketing-lead',
      capabilities: ['content', 'social', 'copy', 'creative'],
      defaultModel: 'claude-sonnet-4-6',
      defaultEffort: 'medium',
      iconKey: 'edit_note',
      colorKey: 'rose',
      delegation: managerOnly,
    },
  ]
}

/**
 * Seed the default org chart for an org. Idempotent — no-op when the org already
 * has any nodes. Recomputes and persists chains after creation.
 *
 * template:
 * - platform → full PiB roster (Pip/Theo/…)
 * - minimal → unbound coordinator + delivery/content leads (client orgs)
 * default: platform when orgId is pib-platform-owner, else minimal
 */
export async function seedOrgChart(
  orgId: string,
  options?: { template?: SeedTemplate },
): Promise<SeedResult> {
  const existing = await listOrgNodes(orgId)
  if (existing.length > 0) {
    return { ok: true, created: 0, skipped: true }
  }

  const template: SeedTemplate =
    options?.template ??
    (orgId === 'pib-platform-owner' ? 'platform' : 'minimal')
  const specs = template === 'platform' ? defaultOrgChartSeed(orgId) : minimalOrgChartSeed(orgId)
  const nodes: AgentOrgNode[] = []
  for (const spec of specs) {
    const result = await createOrgNode({
      id: spec.id,
      orgId,
      agentId: spec.agentId,
      name: spec.name,
      title: spec.title,
      reportsTo: spec.reportsTo,
      capabilities: spec.capabilities,
      defaultModel: spec.defaultModel ?? null,
      defaultEffort: spec.defaultEffort ?? null,
      delegation: spec.delegation,
      status: 'active',
      iconKey: spec.iconKey,
      colorKey: spec.colorKey,
    })
    if (!result.ok) return { ok: false, created: 0, skipped: false, error: result.error }
    if (result.node) nodes.push(result.node)
  }

  // Validate + persist derived chains.
  const tree = buildOrgTree(nodes)
  if (!tree.ok) return { ok: false, created: nodes.length, skipped: false, error: `Seed produced invalid tree: ${tree.error}` }

  // Reparent validation is a safety net — the seed spec is authored acyclic.
  for (const node of nodes) {
    if (!node.reportsTo) continue
    const check = validateReparent(nodes, node.id, node.reportsTo)
    if (!check.ok) return { ok: false, created: nodes.length, skipped: false, error: `Seed reparent check failed for ${node.id}: ${check.error}` }
  }

  await persistChains(orgId, nodes)
  return { ok: true, created: nodes.length, skipped: false }
}
