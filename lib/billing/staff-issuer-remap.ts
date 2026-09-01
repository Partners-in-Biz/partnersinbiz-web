import type { ApiUser } from '@/lib/api/types'
import { findDuplicateCompany, loadCompany } from '@/lib/companies/store'
import type { AssignableCrmRecord } from '@/lib/crm/assignment-access'
import { memberCanIssueInvoices, memberCanIssueQuotes, type MemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'
import { loadPlatformStaffMembership } from '@/lib/orgMembers/platform-staff'
import type { OrgRole } from '@/lib/organizations/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export type StaffIssuerRemap = {
  sourceOrgId: string
  recipientOrgId: string
  companyId?: string
  contactId?: string
  company: AssignableCrmRecord | null
  contact: AssignableCrmRecord | null
  policy: MemberAccessPolicy
  role: OrgRole
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function loadPlatformCompanyForClient(input: {
  platformOrgId: string
  clientOrgId: string
  companyId?: string
}): Promise<{ id: string; record: AssignableCrmRecord } | null> {
  const requestedId = clean(input.companyId)
  if (requestedId) {
    const loaded = await loadCompany(requestedId, input.platformOrgId)
    if (loaded) {
      const linkedOrgId = clean(loaded.data.linkedOrgId)
      if (!linkedOrgId || linkedOrgId === input.clientOrgId) {
        return { id: loaded.data.id, record: { ...loaded.data, id: loaded.data.id } }
      }
    }
  }
  const match = await findDuplicateCompany(input.platformOrgId, { linkedOrgId: input.clientOrgId })
  if (!match?.id) return null
  const loaded = await loadCompany(match.id, input.platformOrgId)
  if (!loaded) return null
  return { id: loaded.data.id, record: { ...loaded.data, id: loaded.data.id } }
}

/**
 * When a PiB staff member (not a client-org owner/admin) posts billing from a
 * client workspace, issuer rows live on pib-platform-owner. Remap source to
 * the platform org and treat the conversation/client org as the recipient.
 *
 * Returns null when the existing path should run unchanged (already on the
 * platform org, client-org book manager, or not PiB staff).
 */
export async function resolvePibStaffIssuerRemap(input: {
  user: ApiUser
  requestedOrgId: string
  companyId?: string
  contactId?: string
  kind?: 'invoices' | 'quotes'
}): Promise<StaffIssuerRemap | null> {
  const requestedOrgId = clean(input.requestedOrgId)
  if (!requestedOrgId) return null
  if (input.user.role === 'admin' || input.user.role === 'ai') return null

  const platformOrgId = PIB_PLATFORM_ORG_ID
  if (requestedOrgId === platformOrgId) return null

  if (await canManageOrgAs(input.user, requestedOrgId, 'admin')) return null

  const staff = await loadPlatformStaffMembership(input.user.uid)
  if (!staff) return null

  const kind = input.kind ?? 'invoices'
  const hasGrant = kind === 'quotes'
    ? memberCanIssueQuotes(staff.policy)
    : memberCanIssueInvoices(staff.policy)
  if (!hasGrant) return null

  const company = await loadPlatformCompanyForClient({
    platformOrgId,
    clientOrgId: requestedOrgId,
    companyId: input.companyId,
  })

  return {
    sourceOrgId: platformOrgId,
    recipientOrgId: requestedOrgId,
    companyId: company?.id || clean(input.companyId) || undefined,
    contactId: clean(input.contactId) || undefined,
    company: company?.record ?? null,
    contact: null,
    policy: staff.policy,
    role: staff.role,
  }
}
