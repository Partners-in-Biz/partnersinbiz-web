type PortalActor = { uid: string; role?: unknown } | null | undefined

type InvoiceLike = {
  status?: unknown
  createdBy?: unknown
  createdByRef?: unknown
}

export type InvoicePortalCapabilitySet = {
  canEdit: boolean
  canSend: boolean
  canCancel: boolean
  canMarkPaid: boolean
}

export type QuoteAccessKind = 'sender' | 'recipient' | 'legacy' | null | undefined

export type QuotePortalCapabilitySet = {
  canEdit: boolean
  canSend: boolean
  canAccept: boolean
  canDecline: boolean
  canConvertToInvoice: boolean
}

type SanitizeResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; status: number; error: string }

const INVOICE_DRAFT_FIELDS = new Set([
  'dueDate',
  'taxRate',
  'notes',
  'lineItems',
  'currency',
  'fromDetails',
  'clientDetails',
  'contactId',
  'companyId',
])

const PORTAL_INVOICE_STATUS_OPTIONS = new Set([
  'draft',
  'sent',
  'viewed',
  'payment_pending_verification',
  'partially_paid',
  'overdue',
  'cancelled',
])

const QUOTE_DRAFT_FIELDS = new Set([
  'notes',
  'validUntil',
  'lineItems',
  'subtotal',
  'taxRate',
  'taxAmount',
  'total',
  'currency',
  'fromDetails',
  'clientDetails',
  'contactId',
  'companyId',
])

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function creatorUid(invoice: InvoiceLike): string {
  const direct = cleanString(invoice.createdBy)
  if (direct) return direct
  const ref = invoice.createdByRef
  if (ref && typeof ref === 'object') return cleanString((ref as { uid?: unknown }).uid)
  return ''
}

function isPrivileged(actor: PortalActor): boolean {
  return actor?.role === 'admin' || actor?.role === 'ai'
}

function canEditInvoiceDraft(actor: PortalActor, invoice: InvoiceLike): boolean {
  if (!actor) return false
  if (cleanString(invoice.status) !== 'draft') return false
  if (isPrivileged(actor)) return true
  return creatorUid(invoice) === actor.uid
}

export function invoicePortalCapabilities(actor: PortalActor, invoice: InvoiceLike): InvoicePortalCapabilitySet {
  const status = cleanString(invoice.status)
  const canEdit = canEditInvoiceDraft(actor, invoice)
  return {
    canEdit,
    canSend: canEdit && status === 'draft',
    canCancel: canEdit && status === 'draft',
    canMarkPaid: false,
  }
}

export function decorateInvoicePortalCapabilities<T extends object>(
  invoice: T,
  actor: PortalActor,
): T & InvoicePortalCapabilitySet {
  return { ...invoice, ...invoicePortalCapabilities(actor, invoice as InvoiceLike) }
}

function sanitizeDraftFields(body: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => allowed.has(key)))
}

export function sanitizeInvoicePortalPatch(
  actor: PortalActor,
  invoice: InvoiceLike,
  body: Record<string, unknown>,
): SanitizeResult {
  const status = cleanString(invoice.status)
  const requestedStatus = cleanString(body.status)
  const bodyKeys = Object.keys(body)
  const statusOnly = bodyKeys.length === 1 && requestedStatus.length > 0
  const canEdit = canEditInvoiceDraft(actor, invoice)

  if (statusOnly) {
    if (requestedStatus === 'paid') {
      return { ok: false, status: 403, error: 'Use the payment-proof or mark-paid workflow to change invoice payment state' }
    }
    if (!actor || status === 'paid') {
      return { ok: false, status: 403, error: 'This invoice status change is not permitted from the portal' }
    }
    if (PORTAL_INVOICE_STATUS_OPTIONS.has(requestedStatus)) {
      return { ok: true, patch: { status: requestedStatus } }
    }
    return { ok: false, status: 403, error: 'This invoice status change is not permitted from the portal' }
  }

  if (!canEdit) {
    return { ok: false, status: 403, error: 'Draft invoice fields can only be edited while the invoice is still in Draft' }
  }

  const patch = sanitizeDraftFields(body, INVOICE_DRAFT_FIELDS)
  if (Object.keys(patch).length === 0) return { ok: false, status: 400, error: 'No editable invoice fields supplied' }
  return { ok: true, patch }
}

function isSender(access: QuoteAccessKind): boolean {
  return access === 'sender' || access === 'legacy'
}

export function quotePortalCapabilities(access: QuoteAccessKind, quote: { status?: unknown; convertedInvoiceId?: unknown }): QuotePortalCapabilitySet {
  const status = cleanString(quote.status)
  const sender = isSender(access)
  const recipient = access === 'recipient'
  return {
    canEdit: sender && status === 'draft',
    canSend: sender && status === 'draft',
    canAccept: recipient && status === 'sent',
    canDecline: recipient && status === 'sent',
    canConvertToInvoice: sender && status === 'accepted' && !cleanString(quote.convertedInvoiceId),
  }
}

export function decorateQuotePortalCapabilities<T extends object>(
  quote: T,
  access: QuoteAccessKind,
): T & QuotePortalCapabilitySet {
  return { ...quote, ...quotePortalCapabilities(access, quote as { status?: unknown; convertedInvoiceId?: unknown }) }
}

export function sanitizeQuotePortalPatch(
  access: QuoteAccessKind,
  quote: { status?: unknown; convertedInvoiceId?: unknown },
  body: Record<string, unknown>,
): SanitizeResult {
  const status = cleanString(quote.status)
  const requestedStatus = cleanString(body.status)
  const bodyKeys = Object.keys(body)
  const statusOnly = bodyKeys.length === 1 && requestedStatus.length > 0
  const capabilities = quotePortalCapabilities(access, quote)

  if (statusOnly) {
    if (access === 'recipient' && status === 'sent' && ['accepted', 'declined', 'rejected'].includes(requestedStatus)) {
      return { ok: true, patch: { status: requestedStatus } }
    }
    if (isSender(access) && status === 'draft' && requestedStatus === 'sent') {
      return { ok: true, patch: { status: requestedStatus } }
    }
    return { ok: false, status: 403, error: 'This quote status change is not permitted from the portal' }
  }

  if (!capabilities.canEdit) {
    return { ok: false, status: 403, error: 'Draft quote fields can only be edited by the sender while the quote is still in Draft' }
  }

  const patch = sanitizeDraftFields(body, QUOTE_DRAFT_FIELDS)
  if (Object.keys(patch).length === 0) return { ok: false, status: 400, error: 'No editable quote fields supplied' }
  return { ok: true, patch }
}
