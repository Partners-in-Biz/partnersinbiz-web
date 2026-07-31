import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { ChatContextAction, ChatContextRelationship } from '@/lib/chat-context/types'
import { adminDb } from '@/lib/firebase/admin'
import { resolveContextReferences } from '@/lib/context-references/registry'

interface UploadDoc {
  id: string
  orgId?: string
  name?: string
  mimeType?: string
  size?: number
  folder?: string
  deleted?: boolean
  updatedAt?: unknown
  relatedTo?: {
    type?: unknown
    id?: unknown
  } | null
}

const FILE_RELATIONSHIPS = [
  'project', 'campaign', 'document', 'report', 'deal',
  'property', 'contact', 'invoice', 'support', 'social',
] as const

type FileRelationshipType = (typeof FILE_RELATIONSHIPS)[number]

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function toIso(value: unknown): string | undefined {
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

function bytes(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value)
  if (typeof value === 'string' && Number.isFinite(Number(value)) && Number(value) >= 0) return Math.trunc(Number(value))
  return undefined
}

function fileActions(userRole: string, id: string): ChatContextAction[] {
  if (userRole !== 'admin') return []
  return [{
    id: `archive-file:${id}`,
    label: 'Archive file',
    href: `/api/v1/files/${encodeURIComponent(id)}`,
    method: 'DELETE',
    requiresApproval: true,
    destructive: true,
  }]
}

function linkable(input: { type: unknown; id: unknown; orgId?: string }) {
  const type = clean(input.type)
  const id = clean(input.id)
  if (!input.orgId || !type || !id) return null
  if (!FILE_RELATIONSHIPS.includes(type as FileRelationshipType)) return null
  return { type: type as FileRelationshipType, id, origin: 'manual' as const, orgId: input.orgId }
}

async function buildRelationships(doc: UploadDoc, user: ApiUser): Promise<ChatContextRelationship[]> {
  const related = linkable({
    type: doc.relatedTo?.type,
    id: doc.relatedTo?.id,
    orgId: doc.orgId,
  })
  if (!related) return []

  const [resolved] = await resolveContextReferences([related], user, doc.orgId)
  if (!resolved) return []

  return [{
    kind: resolved.type,
    id: resolved.id,
    label: resolved.label,
    relation: 'Source',
    ...(resolved.href ? { href: resolved.href } : {}),
  }]
}

function maybeUrl(value: unknown): string | undefined {
  const raw = clean(value, 800)
  if (!raw) return undefined
  try {
    const candidate = new URL(raw)
    return ['http:', 'https:'].includes(candidate.protocol) ? candidate.toString() : undefined
  } catch {
    return undefined
  }
}

export const fileChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'file') return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported file context' }

    const snap = await adminDb.collection('uploads').doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const doc = { ...snap.data(), id: snap.id } as UploadDoc
    if (doc.deleted) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    if (!doc.orgId || !canAccessOrg(input.user, doc.orgId)) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const expectedOrg = input.user.activeOrgId || input.user.orgId
    if (expectedOrg && doc.orgId !== expectedOrg) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const fileName = clean(doc.name, 160) || `File ${doc.id}`
    const size = bytes(doc.size)
    const mime = clean(doc.mimeType, 120) || 'unknown'
    const folder = clean(doc.folder, 120) || 'root'
    const updatedAt = toIso(doc.updatedAt)
    const actions = fileActions(input.user.role, doc.id)
    const relationships = await buildRelationships(doc, input.user)

    return {
      ok: true,
      model: {
        context: {
          kind: 'file',
          id: doc.id,
          orgId: doc.orgId,
          label: fileName,
          icon: 'attach_file',
          href: `/admin/files/${encodeURIComponent(doc.id)}`,
        },
        pulse: {
          label: 'File',
          metrics: [
            { id: 'type', label: 'MIME', value: mime },
            { id: 'folder', label: 'Folder', value: folder },
            ...(size === undefined ? [] : [{ id: 'size', label: 'Size', value: `${size} B` }]),
          ],
          headline: fileName,
        },
        groups: [{
          id: 'overview',
          label: 'File',
          items: [{
            id: doc.id,
            label: fileName,
            state: 'ready',
            detail: [mime, folder].filter(Boolean).join(' · '),
            href: maybeUrl(doc.name) || `/admin/files/${encodeURIComponent(doc.id)}`,
            ...(updatedAt ? { updatedAt } : {}),
            ...(actions.length ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention: [],
        activity: [],
        preview: {
          kind: 'document',
          text: fileName,
        },
        ...(relationships.length ? { relationships } : {}),
        capabilities: ['open', 'preview', ...(actions.length ? ['inline-actions'] : [])],
        asOf: updatedAt || new Date().toISOString(),
      },
    }
  },
}
