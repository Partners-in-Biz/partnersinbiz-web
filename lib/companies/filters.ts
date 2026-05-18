// lib/companies/filters.ts
//
// Pure helpers for composing Firestore queries against the `companies` collection
// plus an in-memory post-filter for substring search.
//
// `buildCompanyQuery` defaults to excluding soft-deleted records — pass
// `{ includeDeleted: true }` to opt out (e.g. for admin restore flows).

import { adminDb } from '@/lib/firebase/admin'
import type { CompanyListParams, Company } from './types'

export interface BuildCompanyQueryOptions {
  /** Default false. When false, query excludes soft-deleted records via `where('deleted', '!=', true)`. */
  includeDeleted?: boolean
}

export function buildCompanyQuery(
  orgId: string,
  params: CompanyListParams,
  opts: BuildCompanyQueryOptions = {},
) {
  let q: FirebaseFirestore.Query = adminDb.collection('companies').where('orgId', '==', orgId)

  // Soft-delete filter (default: exclude).
  // Use equality (== false) rather than inequality (!= true) so Firestore does NOT
  // require `deleted` as the first orderBy field. All company documents created
  // through this API explicitly set `deleted: false`, so equality is safe.
  const excludeDeleted = !opts.includeDeleted
  if (excludeDeleted) {
    q = q.where('deleted', '==', false)
  }

  if (params.industry)          q = q.where('industry', '==', params.industry)
  if (params.size)              q = q.where('size', '==', params.size)
  if (params.tier)              q = q.where('tier', '==', params.tier)
  if (params.lifecycleStage)    q = q.where('lifecycleStage', '==', params.lifecycleStage)
  if (params.accountManagerUid) q = q.where('accountManagerUid', '==', params.accountManagerUid)
  if (params.tags && params.tags.length > 0) {
    q = q.where('tags', 'array-contains-any', params.tags.slice(0, 10))
  }

  // Ordering: no forced `deleted` prefix needed with equality filter.
  const orderField = params.orderBy === 'name-asc'
    ? 'name'
    : params.orderBy === 'updatedAt-desc'
      ? 'updatedAt'
      : 'createdAt'
  const orderDir: FirebaseFirestore.OrderByDirection = params.orderBy === 'name-asc' ? 'asc' : 'desc'
  q = q.orderBy(orderField, orderDir)

  q = q.limit(Math.min(params.limit ?? 50, 200))
  return q
}

/**
 * In-memory substring match across name / domain / website (case-insensitive).
 * Spec-aligned with `GET /api/v1/crm/companies?search=` contract.
 * Note: industry is NOT matched here — use the explicit `?industry=` query param for exact equality.
 */
export function applyPostFilterSearch(companies: Company[], search: string): Company[] {
  if (!search.trim()) return companies
  const needle = search.toLowerCase().trim()
  return companies.filter(c =>
    c.name?.toLowerCase().includes(needle) ||
    c.domain?.toLowerCase().includes(needle) ||
    c.website?.toLowerCase().includes(needle),
  )
}
