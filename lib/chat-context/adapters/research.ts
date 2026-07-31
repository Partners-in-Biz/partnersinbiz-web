import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type {
  ChatContextAction,
  ContextDisplayState,
  ChatContextRelationship,
} from '@/lib/chat-context/types'
import type { ResearchItem } from '@/lib/research/types'
import { getResearchItem } from '@/lib/research/store'
import { resolveContextReferences } from '@/lib/context-references/registry'

type SafeResearchItem = ResearchItem & {
  linked?: Record<string, unknown>
  findings?: unknown[]
  recommendations?: unknown[]
}

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function asIso(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (!value || typeof value !== 'object') return undefined
  try {
    const converted = (value as { toDate?: () => Date; toMillis?: () => number; seconds?: number; _seconds?: number }).toDate?.()
      ?? null
    if (converted && Number.isFinite(converted.getTime())) return converted.toISOString()
    const millis = (value as { toMillis?: () => number }).toMillis?.()
    if (typeof millis === 'number' && Number.isFinite(millis)) return new Date(millis).toISOString()
    const seconds = (value as { seconds?: number; _seconds?: number }).seconds
      ?? (value as { seconds?: number; _seconds?: number })._seconds
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString()
  } catch {
    return undefined
  }
  return undefined
}

function stateFromStatus(status: string): ContextDisplayState {
  switch (status) {
    case 'verified':
    case 'used_in_document':
      return 'complete'
    case 'in_review':
      return 'needs_approval'
    case 'archived':
      return 'archived'
    default:
      return 'ready'
  }
}

function countOpen(items: unknown[]): { total: number; open: number } {
  if (!Array.isArray(items)) return { total: 0, open: 0 }
  const normalized = items
    .map((item) => (item && typeof item === 'object' ? item as Record<string, unknown> : null))
    .filter((item): item is Record<string, unknown> => Boolean(item))
  return {
    total: normalized.length,
    open: normalized.filter((item) => clean(item.status).toLowerCase() === 'open').length,
  }
}

function actionsForResearch(item: SafeResearchItem, role?: string) {
  if (role !== 'admin') return []
  return [
    {
      id: `create-research-document:${item.id}`,
      label: 'Create linked document',
      href: `/api/v1/research/${encodeURIComponent(item.id)}/create-document`,
      method: 'POST',
      requiresApproval: true,
    },
    {
      id: `archive-research:${item.id}`,
      label: 'Archive research item',
      href: `/api/v1/research/${encodeURIComponent(item.id)}`,
      method: 'DELETE',
      requiresApproval: true,
      destructive: true,
    },
  ] as ChatContextAction[]
}

async function buildRelationships(
  item: SafeResearchItem,
  actor: Parameters<ChatContextAdapter['resolve']>[0],
): Promise<ChatContextRelationship[]> {
  const linked = item.linked ?? {}
  const pairs: Array<{ type: Parameters<typeof resolveContextReferences>[0][0]['type']; id?: string; relation: string }> = []

  function add(type: Parameters<typeof pairs>[number]['type'], id: unknown, relation: string) {
    if (typeof id !== 'string') return
    const safeId = id.trim().slice(0, 200)
    if (safeId) pairs.push({ type, id: safeId, relation })
  }

  add('project', linked.projectId, 'Project')
  add('contact', linked.contactId, 'Contact')
  add('company', linked.companyId, 'Company')
  add('deal', linked.dealId, 'Deal')
  add('campaign', linked.campaignId, 'Campaign')
  add('seo_sprint', linked.seoSprintId, 'SEO sprint')
  if (Array.isArray(linked.projectIds)) {
    for (const id of linked.projectIds.slice(0, 2)) add('project', id, 'Project')
  }
  if (Array.isArray(linked.documentIds)) {
    for (const id of linked.documentIds.slice(0, 2)) add('document', id, 'Document')
  }

  const seeds = pairs.slice(0, 8).map((entry) => ({
    type: entry.type,
    id: entry.id,
    orgId: actor.user.orgId,
    origin: 'manual',
  }))

  const resolved = await Promise.all(seeds.map(async (seed) => {
    const [reference] = await resolveContextReferences([seed], actor.user, actor.user.orgId)
    if (!reference) return null
    return {
      kind: reference.type,
      id: reference.id,
      label: reference.label,
      relation: entryRelation(reference, pairs, seed.id),
      ...(reference.href ? { href: reference.href } : {}),
    }
  }))

  return resolved.filter((entry): entry is ChatContextRelationship => Boolean(entry))
}

function entryRelation(reference: { type: string; id: string }, pairs: { type: string; id: string; relation: string }[], fallback: string) {
  const hit = pairs.find((pair) => pair.type === reference.type && pair.id === reference.id)
  return hit?.relation || fallback
}

export const researchChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    const item = await getResearchItem(input.id)
    if (!item || item.deleted) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const userOrg = input.user.activeOrgId || input.user.orgId || ''
    if (!item.orgId || (userOrg && item.orgId !== userOrg)) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const safe = item as SafeResearchItem
    const status = clean(safe.status || 'draft', 80)
    const findings = countOpen(Array.isArray(safe.findings) ? safe.findings : [])
    const recommendations = countOpen(Array.isArray(safe.recommendations) ? safe.recommendations : [])
    const updatedAt = asIso(safe.updatedAt)
    const href = `/admin/research/${encodeURIComponent(item.id)}`
    const relationships = await buildRelationships(safe, input)
    const actions = actionsForResearch(safe, input.user.role)

    return {
      ok: true,
      model: {
        context: {
          kind: 'research',
          id: safe.id,
          orgId: safe.orgId,
          label: `${clean(safe.title, 120) || 'Research'} · ${clean(safe.kind || '', 40) || 'item'}`,
          icon: 'science',
          href,
        },
        pulse: {
          label: 'Research item',
          metrics: [
            { id: 'status', label: 'Status', value: status || 'Draft' },
            { id: 'visibility', label: 'Visibility', value: clean(safe.visibility, 20) || 'Internal' },
            { id: 'findings', label: 'Findings', value: findings.total },
            { id: 'open-findings', label: 'Open findings', value: findings.open },
            { id: 'recommendations', label: 'Recommendations', value: recommendations.total },
            { id: 'open-recommendations', label: 'Open recommendations', value: recommendations.open },
          ],
          ...(safe.summary ? { headline: clean(safe.summary, 260) } : {}),
        },
        groups: [{
          id: 'overview',
          label: 'Research',
          items: [{
            id: safe.id,
            label: clean(safe.title, 140) || 'Research item',
            state: stateFromStatus(status),
            detail: clean(safe.summary, 260) || clean(safe.notesMarkdown, 260) || 'No summary notes yet',
            ...(updatedAt ? { updatedAt } : {}),
            href,
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention: [],
        activity: [],
        preview: {
          kind: 'summary',
          text: clean(safe.summary, 260) || `${clean(safe.title, 100)} · ${status}`,
          status,
          ...(updatedAt ? { version: updatedAt } : {}),
        },
        ...(relationships.length > 0 ? { relationships } : {}),
        capabilities: ['open', 'preview', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: asIso(safe.updatedAt) || new Date().toISOString(),
      },
    }
  },
}

