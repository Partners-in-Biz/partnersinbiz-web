import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { ChatContextAction, ChatContextRelationship, ContextDisplayState } from '@/lib/chat-context/types'
import { getResearchItem } from '@/lib/research/store'
import { resolveContextReferences } from '@/lib/context-references/registry'

interface RelationshipSeed {
  type: 'project' | 'campaign' | 'seo_sprint' | 'deal' | 'company' | 'contact' | 'document' | 'property' | 'social' | 'support'
  id: string
  relation: string
}

function clean(value: unknown, max = 240): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function asIso(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    const toDate = (value as { toDate?: () => Date }).toDate
    if (typeof toDate === 'function') {
      const parsed = toDate()
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined
    }
  }
  return undefined
}

function countByStatus(items: Array<{ status?: unknown }>) {
  const total = items.length
  const open = items.filter((item) => clean(item.status, 24).toLowerCase() === 'open').length
  return { total, open }
}

function stateFromStatus(status: unknown): ContextDisplayState {
  const normalized = clean(status, 24).toLowerCase()
  if (normalized === 'verified' || normalized === 'used_in_document') return 'complete'
  if (normalized === 'in_review') return 'review'
  if (normalized === 'archived') return 'archived'
  return 'ready'
}

function canMutateResearch(role: ApiUser['role']) {
  return role === 'admin' || role === 'ai'
}

function actionsForResearch(input: { id: string; status: string; role: ApiUser['role'] }): ChatContextAction[] {
  if (!canMutateResearch(input.role) || input.status === 'archived') return []
  return [
    {
      id: `create-research-document:${input.id}`,
      label: 'Create linked document',
      href: `/api/v1/research/${encodeURIComponent(input.id)}/create-document`,
      method: 'POST',
      requiresApproval: true,
    },
    {
      id: `archive-research:${input.id}`,
      label: 'Archive research item',
      href: `/api/v1/research/${encodeURIComponent(input.id)}`,
      method: 'DELETE',
      requiresApproval: true,
      destructive: true,
    },
  ]
}

function collectRelationshipSeeds(linked: Record<string, unknown> | null | undefined): RelationshipSeed[] {
  if (!linked || typeof linked !== 'object') return []
  const seeds: RelationshipSeed[] = []
  const seen = new Set<string>()

  const addSeed = (type: RelationshipSeed['type'], relation: string, rawId: unknown) => {
    const id = clean(rawId)
    if (!id) return
    const key = `${type}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    seeds.push({ type, id, relation })
  }

  const addArray = (type: RelationshipSeed['type'], relation: string, rawIds: unknown) => {
    if (!Array.isArray(rawIds)) return
    for (const rawId of rawIds.slice(0, 3)) {
      addSeed(type, relation, rawId)
    }
  }

  addSeed('project', 'Project', linked.projectId)
  addArray('project', 'Project', linked.projectIds)
  addSeed('campaign', 'Campaign', linked.campaignId)
  addSeed('seo_sprint', 'SEO sprint', linked.seoSprintId)
  addSeed('deal', 'Deal', linked.dealId)
  addArray('deal', 'Deal', linked.dealIds)
  addSeed('company', 'Company', linked.companyId)
  addArray('company', 'Company', linked.companyIds)
  addSeed('contact', 'Contact', linked.contactId)
  addArray('contact', 'Contact', linked.contactIds)
  addArray('document', 'Document', linked.documentIds)
  addArray('property', 'Property', linked.propertyIds)
  addArray('social', 'Social post', linked.socialPostIds)
  addArray('support', 'Support ticket', linked.supportTicketIds)

  return seeds
}

async function buildRelationships(item: { orgId: string; linked?: unknown }, user: ApiUser): Promise<ChatContextRelationship[]> {
  const seeds = collectRelationshipSeeds(item.linked && typeof item.linked === 'object' && !Array.isArray(item.linked) ? item.linked as Record<string, unknown> : undefined)
  if (seeds.length === 0) return []

  const refs = await resolveContextReferences(
    seeds.slice(0, 10).map((seed) => ({
      type: seed.type,
      id: seed.id,
      orgId: item.orgId,
      origin: 'manual' as const,
      metadata: { relation: seed.relation },
    })),
    user,
    item.orgId,
  )

  return refs
    .map((ref) => ({
      kind: ref.type,
      id: ref.id,
      label: ref.label,
      relation: clean(ref.metadata?.relation, 80) || 'Related',
      ...(ref.href ? { href: ref.href } : {}),
    }))
}

export const researchChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'research') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported research context' }
    }

    const expectedOrg = input.user.activeOrgId || input.user.orgId
    const item = await getResearchItem(input.id, expectedOrg)

    if (!item || item.deleted) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }
    if (!item.orgId || !canAccessOrg(input.user, item.orgId) || item.orgId !== expectedOrg) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const findings = countByStatus(Array.isArray(item.findings) ? item.findings : [])
    const recommendations = countByStatus(Array.isArray(item.recommendations) ? item.recommendations : [])
    const title = clean(item.title, 140) || 'Research item'
    const kind = clean(item.kind, 80)
    const status = clean(item.status, 40)
    const visibility = clean(item.visibility, 20)
    const summary = clean(item.summary, 260)
    const notes = clean(item.notesMarkdown, 260)
    const updatedAt = asIso(item.updatedAt)
    const href = `/admin/research/${encodeURIComponent(item.id)}`
    const actions = actionsForResearch({ id: item.id, status, role: input.user.role })
    const relationships = await buildRelationships(item, input.user)

    return {
      ok: true,
      model: {
        context: {
          kind: 'research',
          id: item.id,
          orgId: item.orgId,
          label: title,
          icon: 'science',
          href,
        },
        pulse: {
          label: 'Research item',
          metrics: [
            { id: 'status', label: 'Status', value: status || 'draft' },
            { id: 'visibility', label: 'Visibility', value: visibility || 'internal' },
            { id: 'kind', label: 'Kind', value: kind || 'research' },
            { id: 'findings', label: 'Findings', value: findings.total },
            { id: 'open-findings', label: 'Open findings', value: findings.open },
            { id: 'recommendations', label: 'Recommendations', value: recommendations.total },
            { id: 'open-recommendations', label: 'Open recommendations', value: recommendations.open },
          ],
          headline: summary || title,
        },
        groups: [{
          id: 'overview',
          label: 'Research',
          items: [{
            id: item.id,
            label: title,
            state: stateFromStatus(item.status),
            detail: summary || notes || 'No summary yet',
            href,
            ...(updatedAt ? { updatedAt } : {}),
            ...(actions.length ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention: [],
        activity: [],
        preview: {
          kind: 'summary',
          text: summary || notes || title,
          status,
        },
        ...(relationships.length ? { relationships } : {}),
        capabilities: ['open', 'preview', ...(actions.length ? ['inline-actions'] : [])],
        asOf: updatedAt || new Date().toISOString(),
      },
    }
  },
}
