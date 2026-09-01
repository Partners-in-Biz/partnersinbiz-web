import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import {
  crmActorCanReadBillingRecord,
  resolveBillingCrmAuthContext,
} from '@/lib/billing/crm-record-scope'
import { loadPlatformStaffMembership } from '@/lib/orgMembers/platform-staff'

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

/**
 * PiB staff dual-scope chats set activeOrgId to the client/conversation org while
 * issuer rows live on pib-platform-owner. Prefer the platform issuer perspective
 * when the caller is platform staff and can access the source org.
 */
async function resolveStaffIssuerPerspective(
  user: ApiUser,
  data: FirebaseFirestore.DocumentData | Record<string, unknown>,
): Promise<string | null> {
  if (user.role !== 'client') return null
  const source = sourceOrgId(data)
  if (!source) return null
  const staff = await loadPlatformStaffMembership(user.uid)
  if (!staff || source !== staff.platformOrgId) return null
  // Platform staff membership is enough — issuer rows live on the platform even
  // when the token's activeOrgId is a client conversation org.
  return source
}

async function resolvePerspectiveOrgId(
  user: ApiUser,
  data: FirebaseFirestore.DocumentData,
  requestedOrgId?: string | null,
): Promise<string | null> {
  const scoped = clean(requestedOrgId)
  const source = sourceOrgId(data)
  const recipient = recipientOrgId(data)
  const staffIssuer = await resolveStaffIssuerPerspective(user, data)

  if (scoped) {
    if (source && scoped === source) return source
    // Conversation/client org on a dual-scope staff token is the recipient side —
    // still treat PiB staff as the issuer when the invoice is platform-sourced.
    if (recipient && scoped === recipient && staffIssuer) return staffIssuer
    if (staffIssuer && scoped === staffIssuer) return staffIssuer
    return scoped
  }

  if (staffIssuer) return staffIssuer

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
  const source = sourceOrgId(data)
  const recipient = recipientOrgId(data)
  const staffIssuer = await resolveStaffIssuerPerspective(user, data)

  if (scopedOrgId) {
    const staffViaRecipientScope = Boolean(
      staffIssuer
      && recipient
      && scopedOrgId === recipient
      && source === staffIssuer,
    )
    if (!canAccessOrg(user, scopedOrgId) && !staffViaRecipientScope) {
      // Do not confirm existence to callers outside their org scope.
      return { ok: false, response: apiError('Invoice not found', 404) }
    }
    if (!orgIds.includes(scopedOrgId) && !staffViaRecipientScope) {
      return { ok: false, response: apiError('Invoice not found', 404) }
    }
  }

  const canSeeInvoiceOrg = orgIds.some((orgId) => canAccessOrg(user, orgId))
    || Boolean(staffIssuer)
  if (!canSeeInvoiceOrg) {
    // Existence-preserving denial for foreign orgs (restricted admin or member).
    return { ok: false, response: apiError('Invoice not found', 404) }
  }

  // Owned-or-linked CRM members only see invoices tied to their book (or created by them).
  // PiB staff issuer checks run against the platform CRM book, not the client recipient org.
  if (user.role === 'client') {
    const crmOrgId = staffIssuer
      || scopedOrgId
      || orgIds.find((orgId) => canAccessOrg(user, orgId))
      || null
    if (crmOrgId) {
      const crmCtx = await resolveBillingCrmAuthContext(user, crmOrgId)
      const allowed = await crmActorCanReadBillingRecord(crmCtx, { id: invoiceId, ...data })
      if (!allowed) return { ok: false, response: apiError('Invoice not found', 404) }
    }
  }

  const perspectiveOrgId = await resolvePerspectiveOrgId(user, data, requestedOrgId)
  const accessKind = resolveInvoiceAccessKind(data, perspectiveOrgId) ?? 'legacy'

  return { ok: true, ref, snap, data, accessKind, perspectiveOrgId }
}

export function isInvoiceIssuerAccess(accessKind: InvoiceAccessKind | null | undefined): boolean {
  return accessKind === 'sender' || accessKind === 'legacy'
}
