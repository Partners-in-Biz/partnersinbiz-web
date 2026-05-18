// lib/scoring/icpScore.ts
//
// Deterministic ICP match score for a contact (synchronous).
//
// Scoring shares:
//   industry     25 pts
//   size         25 pts
//   tier         20 pts
//   region       15 pts
//   employeeCount 15 pts
// Total max: 100

import type { Contact } from '@/lib/crm/types'
import type { Company } from '@/lib/companies/types'
import type { IcpProfile, ScoreResult } from './types'

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function icpHasCriteria(icp: IcpProfile): boolean {
  return !!(
    (icp.industries && icp.industries.length > 0) ||
    (icp.sizes && icp.sizes.length > 0) ||
    (icp.tiers && icp.tiers.length > 0) ||
    (icp.regions && icp.regions.length > 0) ||
    icp.minEmployeeCount != null ||
    icp.maxEmployeeCount != null
  )
}

export function computeIcpScore(
  contact: Contact,
  company: Company | null | undefined,
  icp: IcpProfile,
): ScoreResult {
  // No company link at all → score 0
  if (!contact.companyId && !contact.company) {
    return { score: 0, signals: {} }
  }

  // No ICP criteria configured → score 0
  if (!icpHasCriteria(icp)) {
    return { score: 0, signals: {} }
  }

  const signals: Record<string, number> = {
    industry: 0,
    size: 0,
    tier: 0,
    region: 0,
    employeeCount: 0,
  }

  // ── Industry (25 pts) ──────────────────────────────────────────────────
  if (icp.industries && icp.industries.length > 0) {
    if (company?.industry && icp.industries.includes(company.industry)) {
      signals.industry = 25
    }
  }

  // ── Size (25 pts) ──────────────────────────────────────────────────────
  if (icp.sizes && icp.sizes.length > 0) {
    if (company?.size && icp.sizes.includes(company.size)) {
      signals.size = 25
    }
  }

  // ── Tier (20 pts) ──────────────────────────────────────────────────────
  if (icp.tiers && icp.tiers.length > 0) {
    if (company?.tier && icp.tiers.includes(company.tier)) {
      signals.tier = 20
    }
  }

  // ── Region (15 pts) ────────────────────────────────────────────────────
  if (icp.regions && icp.regions.length > 0) {
    const address = company?.address
    if (address) {
      const matched = icp.regions.some((r) => {
        if (r.country && address.country !== r.country) return false
        if (r.state && address.state !== r.state) return false
        // If region only specifies country (no state), match on country alone
        return true
      })
      if (matched) signals.region = 15
    }
  }

  // ── Employee count (15 pts) ────────────────────────────────────────────
  if (icp.minEmployeeCount != null || icp.maxEmployeeCount != null) {
    const ec = company?.employeeCount
    if (ec != null) {
      const aboveMin = icp.minEmployeeCount == null || ec >= icp.minEmployeeCount
      const belowMax = icp.maxEmployeeCount == null || ec <= icp.maxEmployeeCount
      if (aboveMin && belowMax) signals.employeeCount = 15
    }
  }

  const raw = signals.industry + signals.size + signals.tier + signals.region + signals.employeeCount
  const score = clamp(raw, 0, 100)

  return { score, signals }
}
