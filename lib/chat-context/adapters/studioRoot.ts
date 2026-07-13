import { adminDb } from '@/lib/firebase/admin'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { ChatContextReadModel, StudioKind } from '@/lib/chat-context/types'
import { resolveContextReferences } from '@/lib/context-references/registry'

type RootDefinition = {
  label: string
  icon: string
  collection: string
  portalHref: string
  adminHref(orgSlug: string): string
  itemHref(id: string, base: string, orgId: string): string
}

const ROOTS: Record<Exclude<StudioKind, 'marketing_studio'>, RootDefinition> = {
  video_editor: {
    label: 'Video Editor', icon: 'video_editor', collection: 'video_editor_projects', portalHref: '/portal/video-editor',
    adminHref: () => '/portal/video-editor',
    itemHref: (id, base, orgId) => `${base}?${new URLSearchParams({ projectId: id, orgId }).toString()}`,
  },
  book_studio: {
    label: 'Book Studio', icon: 'book_studio', collection: 'book_studio_projects', portalHref: '/portal/book-studio',
    adminHref: (slug) => `/admin/org/${encodeURIComponent(slug)}/book-studio`, itemHref: (id, base) => `${base}/${encodeURIComponent(id)}`,
  },
  youtube_studio: {
    label: 'YouTube Studio', icon: 'youtube_studio', collection: 'youtube_video_projects', portalHref: '/portal/youtube-studio',
    adminHref: (slug) => `/admin/org/${encodeURIComponent(slug)}/youtube-studio`, itemHref: (id, base) => `${base}/editor/${encodeURIComponent(id)}`,
  },
  mobile_apps: {
    label: 'Mobile Apps', icon: 'mobile_apps', collection: 'mobile_apps', portalHref: '/portal/mobile-apps',
    adminHref: (slug) => `/admin/org/${encodeURIComponent(slug)}/mobile-apps`, itemHref: (id, base) => `${base}?appId=${encodeURIComponent(id)}`,
  },
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 160) : ''
}

function state(value: unknown): ChatContextReadModel['groups'][number]['items'][number]['state'] {
  const status = clean(value).toLowerCase()
  if (status === 'archived' || status === 'deprecated') return 'archived'
  if (status === 'live' || status === 'published') return 'published'
  if (status === 'rendering' || status === 'in_production') return 'running'
  if (status.includes('review')) return 'review'
  if (status === 'blocked' || status === 'failed' || status === 'paused') return 'blocked'
  return 'ready'
}

export const nonMarketingStudioRootChatContextAdapter: ChatContextAdapter = {
  async resolve({ id, user }) {
    const separator = id.indexOf(':')
    const kind = id.slice(0, separator) as Exclude<StudioKind, 'marketing_studio'>
    const orgId = id.slice(separator + 1)
    const definition = ROOTS[kind]
    if (!definition || !orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const [reference] = await resolveContextReferences([{ type: 'studio', id, orgId }], user, orgId)
    if (!reference || reference.id !== id || reference.orgId !== orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
    const orgData = orgSnap.exists ? orgSnap.data() ?? {} : {}
    const slug = clean(orgData.slug)
    const base = user.role === 'client' ? definition.portalHref : slug ? definition.adminHref(slug) : (reference.href ?? definition.portalHref)
    const snap = await adminDb.collection(definition.collection).where('orgId', '==', orgId).limit(50).get()
    const records: Array<Record<string, unknown> & { id: string }> = snap.docs
      .map((doc): Record<string, unknown> & { id: string } => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
      .filter((record) => record.orgId === orgId && record.deleted !== true && record.archived !== true)
      .filter((record) => user.role !== 'client' || (record.visibility as Record<string, unknown> | undefined)?.showInClientPortal !== false)

    return { ok: true, model: {
      context: { kind: 'studio', id, orgId, label: definition.label, icon: definition.icon, href: base },
      pulse: { label: `${records.length} workspace item${records.length === 1 ? '' : 's'}`, metrics: [
        { id: 'items', label: 'Items', value: records.length },
        { id: 'attention', label: 'Needs attention', value: records.filter((record) => ['blocked', 'failed', 'paused'].includes(clean(record.status))).length },
      ] },
      groups: records.length ? [{ id: 'workspace', label: 'Workspace', items: records.map((record) => ({
        id: record.id, label: clean(record.title) || clean(record.name) || `${definition.label} item`, state: state(record.status),
        detail: clean(record.status).replace(/_/g, ' '), href: definition.itemHref(record.id, base, orgId),
      })) }] : [],
      artifacts: [], attention: [], activity: [], capabilities: ['view'], asOf: new Date().toISOString(),
    } }
  },
}
