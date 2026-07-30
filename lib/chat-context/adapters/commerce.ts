import { adminDb } from '@/lib/firebase/admin'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type {
  ChatContextAction,
  ChatContextReadModel,
  ChatContextRelationship,
  ContextAttentionSummary,
  ContextDisplayState,
} from '@/lib/chat-context/types'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { resolveBillingCrmAuthContext } from '@/lib/billing/crm-record-scope'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'
import { ROLE_RANK } from '@/lib/orgMembers/types'
import { quotePortalCapabilities, type QuoteAccessKind } from '@/lib/billing/portal-permissions'

type CommerceKind = 'invoice' | 'quote'
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

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function recipientEmail(data: RawDoc): string {
  const details = data.clientDetails && typeof data.clientDetails === 'object' && !Array.isArray(data.clientDetails)
    ? data.clientDetails as RawDoc
    : {}
  return clean(details.email, 200) || clean(data.recipientEmail, 200)
}

function sourceOrgId(data: RawDoc): string {
  return clean(data.sourceOrgId, 200) || clean(data.orgId, 200)
}

function recipientOrgId(data: RawDoc): string {
  return clean(data.recipientOrgId, 200) || clean(data.targetOrgId, 200)
}

function quoteAccess(data: RawDoc, perspectiveOrgId: string): QuoteAccessKind {
  const source = sourceOrgId(data)
  if (source && source === perspectiveOrgId) {
    return clean(data.sourceOrgId, 200) ? 'sender' : 'legacy'
  }
  return recipientOrgId(data) === perspectiveOrgId ? 'recipient' : null
}

function actorCanWrite(role: string): boolean {
  return role === 'system' || ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK.member
}

function invoiceState(status: string): ContextDisplayState {
  if (status === 'paid') return 'complete'
  if (status === 'payment_pending_verification') return 'needs_approval'
  if (status === 'overdue') return 'blocked'
  if (status === 'cancelled') return 'archived'
  if (status === 'sent' || status === 'viewed' || status === 'partially_paid') return 'running'
  return 'ready'
}

function quoteState(status: string): ContextDisplayState {
  if (status === 'accepted' || status === 'converted') return 'complete'
  if (status === 'declined' || status === 'expired') return 'archived'
  if (status === 'sent') return 'needs_approval'
  return 'ready'
}

export function commerceChatActions(input: {
  kind: CommerceKind
  id: string
  data: RawDoc
  perspectiveOrgId: string
  actorRole: string
  canManageSourceOrg?: boolean
}): ChatContextAction[] {
  const id = clean(input.id, 200)
  if (!id || !actorCanWrite(input.actorRole)) return []

  const status = clean(input.data.status, 80)
  const email = recipientEmail(input.data)
  if (input.kind === 'invoice') {
    if (status === 'draft' && email && input.canManageSourceOrg) {
      return [{
        id: `send-invoice:${id}`,
        label: `Send invoice to ${email}`,
        href: `/api/v1/invoices/${encodeURIComponent(id)}/send`,
        method: 'POST',
        requiresApproval: true,
      }]
    }
    return []
  }

  const access = quoteAccess(input.data, input.perspectiveOrgId)
  const capabilities = quotePortalCapabilities(access, input.data)
  const apiHref = `/api/v1/quotes/${encodeURIComponent(id)}`
  if (capabilities.canSend && email) {
    return [{
      id: `send-quote:${id}`,
      label: `Send quote to ${email}`,
      href: `${apiHref}/send`,
      method: 'POST',
      requiresApproval: true,
    }]
  }
  if (capabilities.canAccept) {
    return [
      {
        id: `accept-quote:${id}`,
        label: 'Accept quote',
        href: apiHref,
        method: 'PATCH',
        requiresApproval: true,
        body: { status: 'accepted' },
      },
      {
        id: `decline-quote:${id}`,
        label: 'Decline quote',
        href: apiHref,
        method: 'PATCH',
        destructive: true,
        requiresApproval: true,
        body: { status: 'declined' },
      },
    ]
  }
  if (capabilities.canConvertToInvoice) {
    return [{
      id: `convert-quote:${id}`,
      label: 'Convert to invoice',
      href: apiHref,
      method: 'PATCH',
      requiresApproval: true,
      body: { action: 'convert-to-invoice' },
    }]
  }
  return []
}

async function relationships(
  data: RawDoc,
  input: Parameters<ChatContextAdapter['resolve']>[0],
  orgId: string,
): Promise<ChatContextRelationship[]> {
  const seeds = [
    { type: 'contact' as const, id: clean(data.contactId, 200) || clean(data.sourceContactId, 200), relation: 'Contact' },
    { type: 'company' as const, id: clean(data.companyId, 200) || clean(data.sourceCompanyId, 200), relation: 'Company' },
  ].filter((seed) => seed.id)
  const refs = await Promise.all(seeds.map(async (seed) => {
    const [ref] = await resolveContextReferences([
      { type: seed.type, id: seed.id, orgId, origin: 'manual' },
    ], input.user, orgId)
    return ref
      ? { kind: ref.type, id: ref.id, label: ref.label, relation: seed.relation, ...(ref.href ? { href: ref.href } : {}) }
      : null
  }))
  return refs.filter((item): item is ChatContextRelationship => Boolean(item))
}

export const commerceChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'invoice' && input.kind !== 'quote') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported commerce context' }
    }
    const orgId = input.user.activeOrgId || input.user.orgId || ''
    if (!orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const [ref] = await resolveContextReferences([
      input.contextReference ?? { type: input.kind, id: input.id, orgId, origin: 'manual' },
    ], input.user, orgId)
    if (!ref || ref.type !== input.kind) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const snap = await adminDb.collection(`${input.kind}s`).doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const data = snap.data() ?? {}
    if (
      data.deleted === true
      || ![sourceOrgId(data), recipientOrgId(data)].filter(Boolean).includes(ref.orgId)
    ) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const auth = await resolveBillingCrmAuthContext(input.user, ref.orgId)
    const canManageSourceOrg = input.kind === 'invoice'
      ? await canManageOrgAs(input.user, sourceOrgId(data))
      : false
    const actions = commerceChatActions({
      kind: input.kind,
      id: snap.id,
      data,
      perspectiveOrgId: ref.orgId,
      actorRole: auth.role,
      canManageSourceOrg,
    })
    const related = await relationships(data, input, sourceOrgId(data))
    const status = clean(data.status, 80) || 'draft'
    const numberLabel = clean(input.kind === 'invoice' ? data.invoiceNumber : data.quoteNumber, 120)
      || ref.label
    const total = number(data.total) ?? 0
    const currency = clean(data.currency, 8) || 'ZAR'
    const relevantDate = dateString(input.kind === 'invoice' ? data.dueDate : data.validUntil)
    const dateLabel = input.kind === 'invoice' ? 'Due' : 'Valid until'
    const href = input.kind === 'invoice'
      ? `/portal/invoicing/${encodeURIComponent(snap.id)}`
      : `/portal/quotes/${encodeURIComponent(snap.id)}`
    const detail = [
      `${currency} ${total.toLocaleString('en-ZA')}`,
      relevantDate ? `${dateLabel}: ${relevantDate.slice(0, 10)}` : '',
      recipientEmail(data) ? `To: ${recipientEmail(data)}` : '',
    ].filter(Boolean).join(' · ')

    const attention: ContextAttentionSummary[] = []
    if (input.kind === 'invoice' && status === 'payment_pending_verification') {
      attention.push({
        id: 'payment-proof-review',
        label: 'Payment proof needs verification',
        state: 'needs_approval',
        detail: 'Open invoicing to confirm the payment method, reference, and amount.',
        href,
      })
    } else if (input.kind === 'invoice' && status === 'overdue') {
      attention.push({
        id: 'invoice-overdue',
        label: 'Invoice is overdue',
        state: 'blocked',
        detail: relevantDate ? `Payment was due ${relevantDate.slice(0, 10)}.` : 'Payment is overdue.',
        href,
      })
    } else if (input.kind === 'quote' && status === 'sent' && quoteAccess(data, ref.orgId) === 'recipient') {
      attention.push({
        id: 'quote-decision',
        label: 'Quote decision required',
        state: 'needs_approval',
        detail,
        href,
        ...(actions.length > 0 ? { actions } : {}),
      })
    }

    const metrics: ChatContextReadModel['pulse']['metrics'] = [
      { id: 'status', label: 'Status', value: titleCase(status) },
      { id: 'total', label: 'Total', value: `${currency} ${total.toLocaleString('en-ZA')}` },
      ...(relevantDate ? [{ id: 'date', label: dateLabel, value: relevantDate.slice(0, 10) }] : []),
      ...(input.kind === 'invoice' && number(data.paidAmount) !== null
        ? [{ id: 'paid', label: 'Paid', value: `${currency} ${number(data.paidAmount)!.toLocaleString('en-ZA')}` }]
        : []),
      ...(input.kind === 'invoice' && number(data.viewCount) !== null
        ? [{ id: 'views', label: 'Views', value: number(data.viewCount)! }]
        : []),
    ]

    return {
      ok: true,
      model: {
        context: {
          kind: input.kind,
          id: snap.id,
          orgId: ref.orgId,
          label: numberLabel,
          icon: input.kind === 'invoice' ? 'receipt_long' : 'request_quote',
          href,
        },
        pulse: {
          label: input.kind === 'invoice' ? 'Invoice' : 'Quote',
          metrics,
          headline: detail,
        },
        groups: [{
          id: 'overview',
          label: 'Commerce control',
          items: [{
            id: snap.id,
            label: numberLabel,
            state: input.kind === 'invoice' ? invoiceState(status) : quoteState(status),
            detail,
            href,
            ...(dateString(data.updatedAt) ? { updatedAt: dateString(data.updatedAt) } : {}),
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention,
        activity: [],
        preview: {
          kind: 'summary',
          text: `${numberLabel} · ${detail}`,
          status,
          ...(dateString(data.updatedAt) ? { version: dateString(data.updatedAt) } : {}),
        },
        ...(related.length > 0 ? { relationships: related } : {}),
        capabilities: ['open', 'preview', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
