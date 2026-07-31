import { resolveBillingCrmAuthContext } from '@/lib/billing/crm-record-scope'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import type {
  ChatContextAction,
  ChatContextReadModel,
  ContextActivitySummary,
  ContextAttentionSummary,
  ContextDisplayState,
} from '@/lib/chat-context/types'
import { adminDb } from '@/lib/firebase/admin'
import { canAccessModule } from '@/lib/orgMembers/access-policy'

type RawDoc = Record<string, unknown>

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dateString(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    const raw = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number; _seconds?: number }
    try {
      const converted = raw.toDate?.()
      if (converted && !Number.isNaN(converted.getTime())) return converted.toISOString()
      const millis = raw.toMillis?.()
      if (typeof millis === 'number' && Number.isFinite(millis)) return new Date(millis).toISOString()
      const seconds = raw.seconds ?? raw._seconds
      if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function actorLabel(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const ref = value as RawDoc
  return clean(ref.displayName, 120) || clean(ref.name, 120) || clean(ref.uid, 160)
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString('en-ZA')}`
  }
}

function readinessGaps(data: RawDoc): string[] {
  return [
    !clean(data.name) ? 'name' : '',
    !clean(data.description) ? 'description' : '',
    !clean(data.unit) ? 'unit' : '',
    (number(data.unitPrice) ?? 0) <= 0 ? 'price' : '',
    !clean(data.currency) ? 'currency' : '',
  ].filter(Boolean)
}

function canManage(role: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'system'
}

export function productChatActions(input: {
  id: string
  orgId: string
  active: boolean
  actorRole: string
}): ChatContextAction[] {
  if (!input.id || !input.orgId || !canManage(input.actorRole)) return []
  const active = !input.active
  return [{
    id: `${active ? 'activate' : 'deactivate'}-product:${input.id}`,
    label: active ? 'Activate product' : 'Deactivate product',
    href: `/api/v1/crm/products/${encodeURIComponent(input.id)}?orgId=${encodeURIComponent(input.orgId)}`,
    method: 'PUT',
    ...(active ? {} : { destructive: true }),
    requiresApproval: true,
    body: { active },
  }]
}

function stateFor(active: boolean, gaps: string[]): ContextDisplayState {
  if (!active) return 'archived'
  if (gaps.includes('price') || gaps.includes('currency')) return 'blocked'
  if (gaps.length > 0) return 'needs_input'
  return 'ready'
}

function activityFor(data: RawDoc): ContextActivitySummary[] {
  const updatedAt = dateString(data.updatedAt)
  const createdAt = dateString(data.createdAt)
  return [
    ...(updatedAt ? [{
      id: 'product-updated',
      type: 'running' as const,
      label: 'Product updated',
      occurredAt: updatedAt,
      ...(actorLabel(data.updatedByRef) ? { actorLabel: actorLabel(data.updatedByRef) } : {}),
    }] : []),
    ...(createdAt ? [{
      id: 'product-created',
      type: 'pickup' as const,
      label: 'Product created',
      occurredAt: createdAt,
      ...(actorLabel(data.createdByRef) ? { actorLabel: actorLabel(data.createdByRef) } : {}),
    }] : []),
  ]
}

export const productChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'product') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported product context' }
    }
    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base

    const snap = await adminDb.collection('products').doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const data = snap.data() ?? {}
    if (data.deleted === true || clean(data.orgId, 200) !== base.model.context.orgId) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const auth = await resolveBillingCrmAuthContext(input.user, base.model.context.orgId)
    if (!canAccessModule(auth.accessPolicy, 'crm')) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const active = data.active !== false
    const gaps = readinessGaps(data)
    const price = number(data.unitPrice) ?? 0
    const currency = clean(data.currency, 8) || 'ZAR'
    const unit = clean(data.unit, 80)
    const label = clean(data.name, 180) || base.model.context.label
    const href = `/portal/settings/products?product=${encodeURIComponent(snap.id)}&orgId=${encodeURIComponent(base.model.context.orgId)}`
    const actions = productChatActions({
      id: snap.id,
      orgId: base.model.context.orgId,
      active,
      actorRole: auth.role,
    })
    const detail = [
      money(price, currency),
      unit ? `per ${unit}` : '',
      clean(data.sku, 100) ? `SKU ${clean(data.sku, 100)}` : '',
    ].filter(Boolean).join(' · ')
    const attention: ContextAttentionSummary[] = []
    if (!active) {
      attention.push({
        id: 'product-inactive',
        label: 'Product is inactive',
        state: 'review',
        detail: 'It is excluded from the active quoting catalog.',
        href,
        ...(actions.length > 0 ? { actions } : {}),
      })
    } else if (gaps.length > 0) {
      attention.push({
        id: 'product-readiness',
        label: 'Catalog setup needs attention',
        state: gaps.includes('price') || gaps.includes('currency') ? 'blocked' : 'needs_input',
        detail: `Missing ${gaps.join(', ')}.`,
        href,
      })
    }

    const metrics: ChatContextReadModel['pulse']['metrics'] = [
      { id: 'status', label: 'Status', value: active ? 'Active' : 'Inactive' },
      { id: 'price', label: 'Unit price', value: money(price, currency) },
      { id: 'unit', label: 'Unit', value: unit || 'Not set' },
      { id: 'readiness', label: 'Quote readiness', value: `${Math.round(((5 - gaps.length) / 5) * 100)}%` },
      ...(number(data.taxRate) !== null
        ? [{ id: 'tax-rate', label: 'Tax rate', value: `${number(data.taxRate)}%` }]
        : []),
    ]

    return {
      ok: true,
      model: {
        context: { ...base.model.context, label, href },
        pulse: {
          label: 'Catalog product',
          metrics,
          headline: clean(data.description) || detail,
          ...(attention[0] ? {
            next: {
              id: attention[0].id,
              label: attention[0].label,
              state: attention[0].state,
              detail: attention[0].detail,
              href,
            },
          } : {}),
        },
        groups: [{
          id: 'catalog',
          label: 'Catalog control',
          items: [{
            id: snap.id,
            label,
            state: stateFor(active, gaps),
            detail,
            href,
            ...(dateString(data.updatedAt) ? { updatedAt: dateString(data.updatedAt) } : {}),
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention,
        activity: activityFor(data),
        preview: {
          kind: 'summary',
          text: `${label} · ${detail}`,
          status: active ? 'active' : 'inactive',
          ...(dateString(data.updatedAt) ? { version: dateString(data.updatedAt) } : {}),
        },
        capabilities: ['open', 'preview', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
