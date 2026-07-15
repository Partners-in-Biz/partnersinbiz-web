import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg, isSuperAdmin } from '@/lib/api/platformAdmin'
import { canAccessModule, recordScopeFor } from '@/lib/orgMembers/access-policy'
import {
  crmRecordAssignedToUid,
  crmRecordCompanyIds,
  type AssignableCrmRecord,
} from '@/lib/crm/assignment-access'

export type AccessibleCompany = AssignableCrmRecord & {
  id: string
  name?: unknown
  linkedOrgId?: unknown
}

export function canApiUserReadCompany(
  user: ApiUser,
  orgId: string,
  company: AccessibleCompany,
  contacts: AssignableCrmRecord[] = [],
): boolean {
  if (!orgId || company.orgId !== orgId || company.deleted === true) return false
  if (user.role === 'ai' || isSuperAdmin(user)) return true
  if (!canAccessOrg(user, orgId)) return false
  if (user.role === 'admin') return true
  if (!user.memberAccessPolicy || !canAccessModule(user.memberAccessPolicy, 'crm')) return false
  if (recordScopeFor(user.memberAccessPolicy, 'crm') === 'all') return true
  if (crmRecordAssignedToUid(company, user.uid)) return true
  return contacts.some((contact) => (
    contact.orgId === orgId
    && contact.deleted !== true
    && crmRecordAssignedToUid(contact, user.uid)
    && crmRecordCompanyIds(contact).includes(company.id)
  ))
}

export async function getAccessibleCompanyForUser(
  companyId: string,
  orgId: string,
  user: ApiUser,
): Promise<AccessibleCompany | null> {
  if (!companyId.trim()) return null
  const snapshot = await adminDb.collection('companies').doc(companyId).get()
  if (!snapshot.exists) return null
  const company = { id: snapshot.id, ...(snapshot.data() ?? {}) } as AccessibleCompany
  if (canApiUserReadCompany(user, orgId, company)) return company
  if (user.role !== 'client') return null
  const contactsSnapshot = await adminDb.collection('contacts')
    .where('orgId', '==', orgId)
    .limit(1000)
    .get()
  const contacts = contactsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as AssignableCrmRecord)
  return canApiUserReadCompany(user, orgId, company, contacts) ? company : null
}
