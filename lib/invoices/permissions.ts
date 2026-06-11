export type InvoiceActor = { uid: string; role?: unknown }

type InvoiceLike = {
  status?: unknown
  createdBy?: unknown
  createdByRef?: unknown
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function creatorUid(invoice: InvoiceLike): string {
  const direct = cleanString(invoice.createdBy)
  if (direct) return direct
  const ref = invoice.createdByRef
  if (ref && typeof ref === 'object') {
    return cleanString((ref as { uid?: unknown }).uid)
  }
  return ''
}

export function canEditInvoiceDraft(user: InvoiceActor | null | undefined, invoice: InvoiceLike): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'ai') return true
  if (cleanString(invoice.status) !== 'draft') return false
  return creatorUid(invoice) === user.uid
}

export function decorateInvoiceEditCapability<T extends object>(
  invoice: T,
  user: InvoiceActor | null | undefined,
): T & { canEdit: boolean } {
  return { ...invoice, canEdit: canEditInvoiceDraft(user, invoice as InvoiceLike) }
}
