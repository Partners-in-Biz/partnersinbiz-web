import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { ChatContextKind, ChatContextRelationship } from '@/lib/chat-context/types'
import { contextReferenceTypeFrom } from '@/lib/context-references/types'
import { resolveContextReferences } from '@/lib/context-references/registry'

const ICONS: Partial<Record<ChatContextKind, string>> = {
  project: 'target', task: 'task_alt', contact: 'person', company: 'domain', product: 'inventory_2',
  document: 'description', research: 'science', social: 'campaign', campaign: 'ads_click', email: 'mail',
  support: 'support_agent', deal: 'handshake', invoice: 'receipt_long', quote: 'request_quote',
  property: 'apartment', seo_sprint: 'query_stats', workspace_folder: 'folder_open',
  workspace_artifact: 'draft', workspace_connection: 'link', workspace_broker_job: 'sync_alt',
  studio: 'auto_awesome', studio_artifact: 'collections', file: 'attach_file', report: 'analytics',
  calendar_event: 'calendar_month',
}

function safeRelationship(value: unknown, relation: string): ChatContextRelationship | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const kind = contextReferenceTypeFrom(raw.kind ?? raw.type)
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 200) : ''
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 240) : ''
  const href = typeof raw.href === 'string' ? raw.href.trim().slice(0, 500) : ''
  if (!kind || !id || !label) return null
  return { kind, id, label, relation, ...(href ? { href } : {}) }
}

export const genericChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    const orgId = input.user.activeOrgId ?? input.user.orgId
    const [ref] = await resolveContextReferences([
      { type: input.kind, id: input.id, orgId, origin: 'manual' },
    ], input.user, orgId)
    if (!ref) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const projectedRelationships = Array.isArray(ref.metadata?.relationshipSeeds)
      ? await Promise.all(ref.metadata.relationshipSeeds.slice(0, 12).map(async (value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return null
          const raw = value as Record<string, unknown>
          const type = contextReferenceTypeFrom(raw.type)
          const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 200) : ''
          const relation = typeof raw.relation === 'string' ? raw.relation.trim().slice(0, 80) : 'Related'
          if (!type || !id) return null
          const [resolved] = await resolveContextReferences([{ type, id, orgId: ref.orgId, origin: 'manual' }], input.user, ref.orgId)
          if (!resolved) return null
          return { kind: resolved.type, id: resolved.id, label: resolved.label, relation, ...(resolved.href ? { href: resolved.href } : {}) } satisfies ChatContextRelationship
        }))
      : []
    if (ref.type === 'task' && typeof ref.metadata?.projectId === 'string') {
      const [project] = await resolveContextReferences([{ type: 'project', id: ref.metadata.projectId, orgId: ref.orgId, origin: 'manual' }], input.user, ref.orgId)
      if (project) projectedRelationships.push({ kind: 'project', id: project.id, label: project.label, relation: 'Project', ...(project.href ? { href: project.href } : {}) })
    }
    const relationships = Array.isArray(ref.metadata?.relationships)
      ? ref.metadata.relationships
          .map((item) => safeRelationship(item, 'Related'))
          .filter((item): item is ChatContextRelationship => Boolean(item))
          .slice(0, 8)
      : projectedRelationships.filter((item): item is ChatContextRelationship => Boolean(item)).slice(0, 8)
    const summary = ref.summary?.trim()

    return {
      ok: true,
      model: {
        context: {
          kind: ref.type,
          id: ref.id,
          orgId: ref.orgId,
          label: ref.label,
          icon: ICONS[ref.type] ?? 'category',
          ...(ref.href ? { href: ref.href } : {}),
        },
        pulse: {
          label: ref.type.replaceAll('_', ' '),
          metrics: [],
          ...(summary ? { headline: summary } : {}),
        },
        groups: summary ? [{ id: 'overview', label: 'Overview', items: [{ id: ref.id, label: ref.label, state: 'ready', detail: summary, ...(ref.href ? { href: ref.href } : {}) }] }] : [],
        artifacts: [],
        attention: [],
        activity: [],
        preview: { kind: ref.type === 'document' ? 'document' : 'summary', ...(summary ? { text: summary } : {}) },
        ...(relationships.length > 0 ? { relationships } : {}),
        capabilities: ref.href ? ['open'] : [],
        asOf: new Date().toISOString(),
      },
    }
  },
}
