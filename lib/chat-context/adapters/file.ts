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
  relatedTo?: { type?: string; id?: string } | null
  createdAt?: unknown
  updatedAt?: unknown
  deleted?: boolean
}

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asIso(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    try {
      const toDate = (value as { toDate?: () => Date }).toDate
      if (typeof toDate === 'function') {
        const parsed = toDate()
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
      }
    } catch {
      return undefined
    }
  }
  return undefined
}

function fileActions(role: string | undefined, id: string): ChatContextAction[] {
  if (role !== 'admin') return []
  return [
    {
      id: `archive-file:${id}`,
      label: 'Archive file',
      href: `/api/v1/files/${encodeURIComponent(id)}`,
      method: 'DELETE',
      requiresApproval: true,
      destructive: true,
    },
  ]
}

function fileMimeMetric(data: UploadDoc): string {
  return clean(data.mimeType, 120) || 'unknown'
}

export const fileChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    const snapshot = await adminDb.collection('uploads').doc(input.id).get()
    if (!snapshot.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const doc = { id: snapshot.id, ...(snapshot.data() as UploadDoc) } as UploadDoc
    if (doc.deleted === true) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const userOrg = input.user.activeOrgId || input.user.orgId || ''
    if (!doc.orgId || (userOrg && doc.orgId !== userOrg)) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const updatedAt = asIso(doc.updatedAt)
    const href = `/admin/files/${encodeURIComponent(doc.id)}`
    const actions = fileActions(input.user.role, doc.id)

    const relationships: ChatContextRelationship[] = []
    const relatedTo = doc.relatedTo ?? {}
    if (typeof relatedTo === 'object' && !Array.isArray(relatedTo)) {
      const refType = clean((relatedTo as { type?: unknown }).type, 80)
      const refId = clean((relatedTo as { id?: unknown }).id, 200)
      if ((['project', 'campaign', 'document', 'report', 'deal', 'property', 'contact'].includes(refType) || true) && refId) {
        const [reference] = await resolveContextReferences([{ type: refType as never, id: refId, orgId: doc.orgId, origin: 'manual' }], input.user, doc.orgId)
        if (reference) {
          relationships.push({ kind: reference.type, id: reference.id, label: reference.label, relation: 'Related record', ...(reference.href ? { href: reference.href } : {}) })
        }
      }
    }

    return {
      ok: true,
      model: {
        context: {
          kind: 'file',
          id: doc.id,
          orgId: doc.orgId,
          label: clean(doc.name, 160) || `File ${doc.id}`,
          icon: 'attach_file',
          href,
        },
        pulse: {
          label: 'File',
          metrics: [
            { id: 'mime', label: 'Mime type', value: fileMimeMetric(doc) },
            { id: 'size', label: 'Size', value: asNumber(doc.size) ?? 0 },
            { id: 'folder', label: 'Folder', value: clean(doc.folder, 120) || 'root' },
          ],
          headline: clean(doc.name, 200) || 'File metadata',
        },
        groups: [{
          id: 'overview',
          label: 'File',
          items: [{
            id: doc.id,
            label: clean(doc.name, 160) || 'File',
            state: 'ready',
            detail: fileMimeMetric(doc),
            href,
            ...(updatedAt ? { updatedAt } : {}),
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention: [],
        activity: [],
        preview: { kind: 'document', text: clean(doc.name, 240) || 'Uploaded file' },
        ...(relationships.length > 0 ? { relationships } : {}),
        capabilities: ['open', 'preview', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: updatedAt || new Date().toISOString(),
      },
    }
  },
}

