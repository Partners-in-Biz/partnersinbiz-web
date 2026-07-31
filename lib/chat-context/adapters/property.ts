import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { ChatContextAction, ContextDisplayState } from '@/lib/chat-context/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'

interface PropertyRecord {
  id: string
  orgId?: string
  name?: string
  domain?: string
  type?: string
  status?: string
  config?: {
    revenue?: {
      timezone?: string
      currency?: string
    }
  }
  createdAt?: unknown
  updatedAt?: unknown
  deleted?: boolean
}

function clean(value: unknown, max = 240): string {
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

function stateFromStatus(status: unknown): ContextDisplayState {
  const normalized = clean(status, 60).toLowerCase()
  if (normalized === 'active') return 'published'
  if (normalized === 'archived' || normalized === 'disabled') return 'archived'
  if (normalized === 'paused') return 'needs_input'
  return 'ready'
}

function actionsForProperty(input: { userRole: ApiUser['role']; id: string }): ChatContextAction[] {
  if (input.userRole !== 'admin') return []
  return [{
    id: `archive-property:${input.id}`,
    label: 'Archive property',
    href: `/api/v1/properties/${encodeURIComponent(input.id)}`,
    method: 'DELETE' as const,
    requiresApproval: true,
    destructive: true,
  }]
}

export const propertyChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'property') return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported property context' }

    const snap = await adminDb.collection('properties').doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }

    const doc = snap.data() as PropertyRecord | undefined
    if (!doc) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const property = { ...doc, id: snap.id } as PropertyRecord

    if (property.deleted || !property.orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const expectedOrg = input.user.activeOrgId || input.user.orgId
    if (expectedOrg && property.orgId !== expectedOrg) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    if (expectedOrg && !canAccessOrg(input.user, property.orgId)) {
      return { ok: false, reason: 'forbidden', status: 403, error: 'Context unavailable' }
    }
    if (!expectedOrg && input.user.role === 'client' && !canAccessOrg(input.user, property.orgId)) {
      return { ok: false, reason: 'forbidden', status: 403, error: 'Context unavailable' }
    }

    const status = clean(property.status, 30)
    const asOf = asIso(property.updatedAt)
    const actions = actionsForProperty({ userRole: input.user.role, id: property.id })
    const revenueCurrency = clean(property.config?.revenue?.currency, 16)
    const timezone = clean(property.config?.revenue?.timezone, 60)

    return {
      ok: true,
      model: {
        context: {
          kind: 'property',
          id: property.id,
          orgId: property.orgId,
          label: clean(property.name, 160) || `Property ${property.id}`,
          icon: 'apartment',
          href: `/admin/properties/${encodeURIComponent(property.id)}`,
        },
        pulse: {
          label: 'Property',
          metrics: [
            { id: 'status', label: 'Status', value: status || 'active' },
            { id: 'type', label: 'Type', value: clean(property.type, 80) || 'web' },
            ...(clean(property.domain, 160) ? [{ id: 'domain', label: 'Domain', value: clean(property.domain, 160) }] : []),
            ...(revenueCurrency ? [{ id: 'currency', label: 'Currency', value: revenueCurrency }] : []),
            ...(timezone ? [{ id: 'timezone', label: 'Timezone', value: timezone }] : []),
          ],
          ...(status ? { headline: `Property is ${status}` } : {}),
        },
        groups: [{
          id: 'property',
          label: 'Property',
          items: [{
            id: property.id,
            label: clean(property.name, 200) || clean(property.domain, 200) || 'Property',
            state: stateFromStatus(property.status),
            detail: clean(property.domain, 240) || `Type: ${clean(property.type, 80) || 'web'}`,
            href: `/admin/properties/${encodeURIComponent(property.id)}`,
            ...(asOf ? { updatedAt: asOf } : {}),
            ...(actions.length ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention: [],
        activity: [],
        preview: {
          kind: 'summary',
          text: clean(property.name, 220) || clean(property.domain, 220) || 'Property',
          ...(status ? { status } : {}),
        },
        capabilities: ['open', 'preview', ...(actions.length ? ['inline-actions'] : [])],
        asOf: asOf || new Date().toISOString(),
      },
    }
  },
}
