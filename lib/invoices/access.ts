import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import {
  crmActorCanReadBillingRecord,
  resolveBillingCrmAuthContext,
} from '@/lib/billing/crm-record-scope'

export type InvoiceAccessKind = 'sender' | 'recipient' | 'legacy'

export type InvoiceAccessOk = {
  ok: true
  ref: FirebaseFirestore.DocumentReference
  snap: FirebaseFirestore.DocumentSnapshot
  data: FirebaseFirestore.DocumentData
  accessKind: InvoiceAccessKind
  perspectiveOrgId: string | null
}

export type InvoiceAccessErr = {
  ok: false
  response: Response
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function invoiceOrgIds(data: FirebaseFirestore.DocumentData | Record<string, unknown>): string[] {
  return [data.orgId, data.sourceOrgId, data.recipientOrgId, data.targetOrgId]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function sourceOrgId(data: FirebaseFirestore.DocumentData | Record<string, unknown>): string {
  return clean(data.sourceOrgId) || clean(data.orgId)
}

function recipientOrgId(data: FirebaseFirestore.DocumentData | Record<string, unknown>): string {
  return clean(data.recipientOrgId) || clean(data.targetOrgId)
}

/**
 * Resolve whether the caller is acting as the invoice issuer (sender/legacy)
 * or as the billed recipient. Cross-org issuer mutations must use sender/legacy only.
 */
export function resolveInvoiceAccessKind(
  data: FirebaseFirestore.DocumentData | Record<string, unknown>,
  perspectiveOrgId?: string | null,
): InvoiceAccessKind | null {
  const perspective = clean(perspectiveOrgId)
  if (!perspective) return null

  const source = sourceOrgId(data)
  if (source && source === perspective) {
    return clean(data.sourceOrgId) ? 'sender' : 'legacy'
  }
  if (recipientOrgId(data) === perspective) return 'recipient'
  return null
}

function resolvePerspectiveOrgId(
  user: ApiUser,
  data: FirebaseFirestore.DocumentData,
  requestedOrgId?: string | null,
): string | null {
  const scoped = clean(requestedOrgId)
  if (scoped) return scoped

  if (user.role === 'client') {
    return clean(user.activeOrgId) || clean(user.orgId) || null
  }

  const orgIds = invoiceOrgIds(data)
  const match = orgIds.find((orgId) => canAccessOrg(user, orgId))
  if (match) return match
  return clean(user.activeOrgId) || clean(user.orgId) || null
}

export async function requireInvoiceAccess(
  user: ApiUser,
  invoiceId: string,
  requestedOrgId?: string | null,
): Promise<InvoiceAccessOk | InvoiceAccessErr> {
  const ref = adminDb.collection('invoices').doc(invoiceId)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, response: apiError('Invoice not found', 404) }

  const data = snap.data() ?? {}
  const orgIds = invoiceOrgIds(data)
  const scopedOrgId = clean(requestedOrgId)
    || (user.role === 'client' ? clean(user.activeOrgId) : '')

  if (scopedOrgId) {
    if (!canAccessOrg(user, scopedOrgId)) {
      // Do not confirm existence to callers outside their org scope.
      return { ok: false, response: apiError('Invoice not found', 404) }
    }
    if (!orgIds.includes(scopedOrgId)) {
      return { ok: false, response: apiError('Invoice not found', 404) }
    }
  }

  if (!orgIds.some((orgId) => canAccessOrg(user, orgId))) {
    // Existence-preserving denial for foreign orgs (restricted admin or member).
    return { ok: false, response: apiError('Invoice not found', 404) }
  }

  // Owned-or-linked CRM members only see invoices tied to their book (or created by them).
  if (user.role === 'client') {
    const perspectiveOrgId = scopedOrgId
      || orgIds.find((orgId) => canAccessOrg(user, orgId))
      || null
    if (perspectiveOrgId) {
      const crmCtx = await resolveBillingCrmAuthContext(user, perspectiveOrgId)
      const allowed = await crmActorCanReadBillingRecord(crmCtx, { id: invoiceId, ...data })
      if (!allowed) return { ok: false, response: apiError('Invoice not found', 404) }
    }
  }

  const perspectiveOrgId = resolvePerspectiveOrgId(user, data, requestedOrgId)
  const accessKind = resolveInvoiceAccessKind(data, perspectiveOrgId) ?? 'legacy'

  return { ok: true, ref, snap, data, accessKind, perspectiveOrgId }
}

export function isInvoiceIssuerAccess(accessKind: InvoiceAccessKind | null | undefined): boolean {
  return accessKind === 'sender' || accessKind === 'legacy'
}
