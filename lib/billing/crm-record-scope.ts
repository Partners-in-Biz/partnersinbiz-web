import { adminDb } from '@/lib/firebase/admin'
import type { CrmAuthContext } from '@/lib/auth/crm-middleware'
import type { ApiUser } from '@/lib/api/types'
import {
  type AssignableCrmRecord,
  crmActorUid,
  crmRecordAssignedToUid,
  crmRecordCompanyIds,
  crmRecordContactIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'
import {
  FULL_ACCESS_POLICY,
  resolveEffectiveMemberPolicy,
} from '@/lib/orgMembers/access-policy'
import { AGENT_PIP_REF, buildHumanRef } from '@/lib/orgMembers/memberRef'
import type { OrgRole } from '@/lib/organizations/types'

/**
 * Build a CRM auth context for billing list/detail routes that use withAuth
 * (invoices) rather than withCrmAuth (quotes / CRM).
 */
export async function resolveBillingCrmAuthContext(
  user: ApiUser,
  orgId: string,
): Promise<CrmAuthContext> {
  if (user.role === 'admin' || user.role === 'ai') {
    return {
      orgId,
      uid: user.uid,
      actor: user.role === 'ai' ? AGENT_PIP_REF : buildHumanRef(user.uid, { displayName: user.uid }),
      role: user.role === 'ai' ? 'system' : 'owner',
      isAgent: user.role === 'ai',
      permissions: {},
      accessPolicy: FULL_ACCESS_POLICY,
      user: {
        uid: user.uid,
        role: user.role,
        orgId: user.orgId,
        allowedOrgIds: user.allowedOrgIds,
      },
    }
  }

  const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${user.uid}`).get()
  const memberData = memberDoc.exists ? (memberDoc.data() ?? {}) : null
  const active = Boolean(memberData && isActiveOrgMembershipRow(memberData))
  const role: OrgRole = active
    ? ((memberData?.role as OrgRole | undefined) ?? 'member')
    : 'member'

  // Org modulePolicies act as defaults for members without an explicit policy.
  let orgModulePolicies: unknown
  try {
    const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
    if (orgSnap.exists) {
      const orgSettings = (orgSnap.data()?.settings ?? {}) as Record<string, unknown>
      orgModulePolicies = orgSettings.modulePolicies
    }
  } catch {
    orgModulePolicies = undefined
  }

  const accessPolicy = active
    ? resolveEffectiveMemberPolicy({
        role,
        accessScope: memberData?.accessScope,
        accessPolicy: memberData?.accessPolicy,
        orgModulePolicies,
      })
    : (user.memberAccessPolicy ?? resolveEffectiveMemberPolicy({ role: 'member' }))

  return {
    orgId,
    uid: user.uid,
    actor: buildHumanRef(user.uid, memberData ?? { displayName: user.uid }),
    role,
    isAgent: false,
    permissions: {},
    accessPolicy,
    user: {
      uid: user.uid,
      role: user.role,
      orgId: user.orgId,
      allowedOrgIds: user.allowedOrgIds,
    },
  }
}

/**
 * Billing docs (invoices/quotes) may have orgId = issuer while the viewer is the
 * recipient org. Visibility is by creator fields on the doc itself, or by linked
 * CRM company/contact ownership in the viewer's org — not by matching
 * invoice.orgId to the viewer org.
 */
function billingRecordVisibleToActor(
  ctx: CrmAuthContext,
  record: AssignableCrmRecord,
  maps: {
    companies: Map<string, AssignableCrmRecord>
    contacts: Map<string, AssignableCrmRecord>
  },
): boolean {
  if (isCrmPrivilegedActor(ctx)) return true
  if (record.deleted === true) return false

  const uid = crmActorUid(ctx)
  if (!uid) return false
  if (crmRecordAssignedToUid(record, uid)) return true

  for (const companyId of crmRecordCompanyIds(record)) {
    if (crmRecordAssignedToUid(maps.companies.get(companyId), uid)) return true
  }

  for (const contactId of crmRecordContactIds(record)) {
    const contact = maps.contacts.get(contactId)
    if (crmRecordAssignedToUid(contact, uid)) return true
    for (const companyId of crmRecordCompanyIds(contact)) {
      if (crmRecordAssignedToUid(maps.companies.get(companyId), uid)) return true
    }
  }

  return false
}

export async function filterBillingRecordsForCrmActor<T extends AssignableCrmRecord>(
  ctx: CrmAuthContext,
  rows: T[],
): Promise<T[]> {
  if (isCrmPrivilegedActor(ctx)) return rows

  const companyIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const row of rows) {
    for (const id of crmRecordCompanyIds(row)) companyIds.add(id)
    for (const id of crmRecordContactIds(row)) contactIds.add(id)
  }

  const [companies, contacts] = await Promise.all([
    loadCompanyAssignmentMap(ctx.orgId, companyIds),
    loadContactAssignmentMap(ctx.orgId, contactIds),
  ])

  return rows.filter((row) => billingRecordVisibleToActor(ctx, row, { companies, contacts }))
}

export async function crmActorCanReadBillingRecord(
  ctx: CrmAuthContext,
  record: AssignableCrmRecord,
): Promise<boolean> {
  if (isCrmPrivilegedActor(ctx)) return true

  const [companies, contacts] = await Promise.all([
    loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(record)),
    loadContactAssignmentMap(ctx.orgId, crmRecordContactIds(record)),
  ])

  return billingRecordVisibleToActor(ctx, record, { companies, contacts })
}
