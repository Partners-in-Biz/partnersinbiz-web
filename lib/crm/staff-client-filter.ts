import type { AssignableCrmRecord, CrmAssignmentMaps } from '@/lib/crm/assignment-access'
import { crmRecordCompanyIds, crmRecordContactIds } from '@/lib/crm/assignment-access'

function linkedOrgIdOf(record: AssignableCrmRecord | null | undefined): string {
  return typeof record?.linkedOrgId === 'string' ? record.linkedOrgId.trim() : ''
}

export function crmRowMatchesStaffClientOrg(
  row: AssignableCrmRecord,
  staffClientOrgId: string,
  maps: CrmAssignmentMaps = {},
): boolean {
  const target = staffClientOrgId.trim()
  if (!target) return true
  if (linkedOrgIdOf(row) === target) return true

  for (const companyId of crmRecordCompanyIds(row)) {
    if (linkedOrgIdOf(maps.companies?.get(companyId)) === target) return true
  }

  for (const contactId of crmRecordContactIds(row)) {
    const contact = maps.contacts?.get(contactId)
    if (linkedOrgIdOf(contact) === target) return true
    for (const companyId of crmRecordCompanyIds(contact)) {
      if (linkedOrgIdOf(maps.companies?.get(companyId)) === target) return true
    }
  }

  return false
}

/** When PiB staff are remapped onto the platform CRM book in a client chat, keep only rows for that client. */
export function filterCrmRowsForStaffClientOrg<T extends AssignableCrmRecord>(
  staffClientOrgId: string | undefined,
  rows: T[],
  maps: CrmAssignmentMaps = {},
): T[] {
  const orgId = typeof staffClientOrgId === 'string' ? staffClientOrgId.trim() : ''
  if (!orgId) return rows
  return rows.filter((row) => crmRowMatchesStaffClientOrg(row, orgId, maps))
}
