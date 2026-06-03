import type { Company } from '@/lib/companies/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export function companyAccountOwnerRef(company: Company): MemberRef | undefined {
  return company.accountManagerRef ?? company.ownerRef
}

export function companyAccountOwnerUid(company: Company): string {
  return String(
    company.accountManagerUid ??
      company.accountManagerRef?.uid ??
      company.ownerUid ??
      company.ownerRef?.uid ??
      '',
  ).trim()
}

export function companyHasAccountOwner(company: Company): boolean {
  return companyAccountOwnerUid(company).length > 0
}

export function companyAccountOwnerLabel(company: Company, fallback = 'Unassigned'): string {
  const ownerRef = companyAccountOwnerRef(company)
  const displayName = ownerRef?.displayName?.trim()
  if (displayName) return displayName
  return companyAccountOwnerUid(company) || fallback
}
