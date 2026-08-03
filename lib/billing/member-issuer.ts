import type { CrmAuthContext } from '@/lib/auth/crm-middleware'
import type { ApiUser } from '@/lib/api/types'
import {
  type AssignableCrmRecord,
  crmActorUid,
  crmRecordAssignedToUid,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'
import {
  memberCanIssueInvoices,
  memberCanIssueQuotes,
  type MemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'
import { loadOrgMemberAccessPolicy } from '@/lib/orgMembers/org-access-policy'
import { resolveBillingCrmAuthContext } from '@/lib/billing/crm-record-scope'

export type BillingIssuerKind = 'invoices' | 'quotes'

function hasIssuerGrant(policy: MemberAccessPolicy | unknown, kind: BillingIssuerKind): boolean {
  return kind === 'invoices' ? memberCanIssueInvoices(policy) : memberCanIssueQuotes(policy)
}

/** Org owner/admin/system/AI/platform admin keep book-level issuer rights. */
export function isBillingBookManager(ctx: Pick<CrmAuthContext, 'role' | 'isAgent'>): boolean {
  return ctx.isAgent || ctx.role === 'system' || ctx.role === 'owner' || ctx.role === 'admin'
}

export function actorHasIssuerGrant(ctx: CrmAuthContext, kind: BillingIssuerKind): boolean {
  if (isBillingBookManager(ctx)) return true
  if (isCrmPrivilegedActor(ctx) && hasIssuerGrant(ctx.accessPolicy, kind)) return true
  return hasIssuerGrant(ctx.accessPolicy, kind)
}

/**
 * Sent/issuer list gate: org owner/admin/system keep the book. Members need
 * an explicit invoice/quote grant (full workspace access implies grant).
 * Granted members still pass through CRM owned_or_linked filtering.
 */
export function shouldExposeIssuerBillingBook(ctx: CrmAuthContext, kind: BillingIssuerKind): boolean {
  if (isBillingBookManager(ctx)) return true
  return hasIssuerGrant(ctx.accessPolicy, kind)
}

/**
 * Fail-closed owned_or_linked check for create. Privileged CRM actors pass.
 * Ordinary members need a company and/or contact that resolves to their book
 * via direct assignment/ownership (not reverse contact discovery).
 */
export async function crmActorCanIssueForTarget(
  ctx: CrmAuthContext,
  target: {
    companyId?: string
    contactId?: string
    company?: AssignableCrmRecord | null
    contact?: AssignableCrmRecord | null
  },
): Promise<boolean> {
  if (isCrmPrivilegedActor(ctx)) return true

  const uid = crmActorUid(ctx)
  if (!uid) return false

  const companyId = typeof target.companyId === 'string' ? target.companyId.trim() : ''
  const contactId = typeof target.contactId === 'string' ? target.contactId.trim() : ''
  if (!companyId && !contactId) return false

  let company = target.company
    ? ({ ...target.company, id: companyId || target.company.id } as AssignableCrmRecord)
    : null
  let contact = target.contact
    ? ({ ...target.contact, id: contactId || target.contact.id } as AssignableCrmRecord)
    : null

  if (companyId && !company) {
    const companies = await loadCompanyAssignmentMap(ctx.orgId, [companyId])
    company = companies.get(companyId) ?? null
  }
  if (contactId && !contact) {
    const contacts = await loadContactAssignmentMap(ctx.orgId, [contactId])
    contact = contacts.get(contactId) ?? null
  }

  if (company && crmRecordAssignedToUid(company, uid)) return true
  if (contact && crmRecordAssignedToUid(contact, uid)) return true

  if (contact) {
    const linkedCompanyIds = [
      typeof contact.companyId === 'string' ? contact.companyId : '',
      companyId,
    ].filter(Boolean)
    if (linkedCompanyIds.length > 0) {
      const companies = await loadCompanyAssignmentMap(ctx.orgId, linkedCompanyIds)
      for (const id of linkedCompanyIds) {
        if (crmRecordAssignedToUid(companies.get(id), uid)) return true
      }
    }
  }

  return false
}

export type InvoiceIssuerDecision =
  | { ok: true; mode: 'platform_admin' | 'org_manager' | 'member_owned' }
  | { ok: false; status: number; error: string }

/**
 * Resolve whether a portal/API user may create an invoice as the issuer org.
 * Platform admin/AI keep existing paths. Org owner/admin keep org book.
 * Members need explicit grant + owned_or_linked CRM target.
 */
export async function resolveInvoiceCreateAccess(input: {
  user: ApiUser
  sourceOrgId: string
  claimable: boolean
  companyId?: string
  contactId?: string
  company?: AssignableCrmRecord | null
  contact?: AssignableCrmRecord | null
}): Promise<InvoiceIssuerDecision> {
  const { user, sourceOrgId } = input

  if (user.role === 'admin' || user.role === 'ai') {
    return { ok: true, mode: 'platform_admin' }
  }

  if (await canManageOrgAs(user, sourceOrgId, 'admin')) {
    return { ok: true, mode: 'org_manager' }
  }

  const policy = await loadOrgMemberAccessPolicy(sourceOrgId, user.uid)
  if (!policy || !memberCanIssueInvoices(policy)) {
    return { ok: false, status: 403, error: 'Invoice issuer rights are not granted for this member' }
  }

  if (!input.claimable || (!input.companyId && !input.contactId)) {
    return {
      ok: false,
      status: 403,
      error: 'Members may only issue invoices for owned or linked CRM clients',
    }
  }

  const ctx = await resolveBillingCrmAuthContext(user, sourceOrgId)
  // Ensure grant is evaluated on the source-org policy we already loaded.
  ctx.accessPolicy = policy
  if (!actorHasIssuerGrant(ctx, 'invoices')) {
    return { ok: false, status: 403, error: 'Invoice issuer rights are not granted for this member' }
  }

  const owned = await crmActorCanIssueForTarget(ctx, {
    companyId: input.companyId,
    contactId: input.contactId,
    company: input.company,
    contact: input.contact,
  })
  if (!owned) {
    return {
      ok: false,
      status: 403,
      error: 'CRM client is outside this member owned or linked scope',
    }
  }

  return { ok: true, mode: 'member_owned' }
}

export type QuoteIssuerDecision =
  | { ok: true; mode: 'agent' | 'org_manager' | 'member_owned' | 'privileged' }
  | { ok: false; status: number; error: string }

export async function resolveQuoteCreateAccess(input: {
  ctx: CrmAuthContext
  companyId?: string
  contactId?: string
  company?: AssignableCrmRecord | null
  contact?: AssignableCrmRecord | null
}): Promise<QuoteIssuerDecision> {
  const { ctx } = input
  if (ctx.isAgent || ctx.role === 'system') return { ok: true, mode: 'agent' }
  if (isBillingBookManager(ctx)) return { ok: true, mode: 'org_manager' }
  if (isCrmPrivilegedActor(ctx) && memberCanIssueQuotes(ctx.accessPolicy)) {
    return { ok: true, mode: 'privileged' }
  }
  if (!memberCanIssueQuotes(ctx.accessPolicy)) {
    return { ok: false, status: 403, error: 'Quote issuer rights are not granted for this member' }
  }
  if (!input.companyId && !input.contactId) {
    return {
      ok: false,
      status: 403,
      error: 'Members may only issue quotes for owned or linked CRM clients',
    }
  }
  const owned = await crmActorCanIssueForTarget(ctx, {
    companyId: input.companyId,
    contactId: input.contactId,
    company: input.company,
    contact: input.contact,
  })
  if (!owned) {
    return {
      ok: false,
      status: 403,
      error: 'CRM client is outside this member owned or linked scope',
    }
  }
  return { ok: true, mode: 'member_owned' }
}
