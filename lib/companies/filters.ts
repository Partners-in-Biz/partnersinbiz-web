// lib/companies/filters.ts
import { adminDb } from '@/lib/firebase/admin'
import type { CompanyListParams, Company } from './types'

export function buildCompanyQuery(orgId: string, params: CompanyListParams) {
  let q: FirebaseFirestore.Query = adminDb.collection('companies').where('orgId', '==', orgId)
  if (params.industry) q = q.where('industry', '==', params.industry)
  if (params.size) q = q.where('size', '==', params.size)
  if (params.tier) q = q.where('tier', '==', params.tier)
  if (params.lifecycleStage) q = q.where('lifecycleStage', '==', params.lifecycleStage)
  if (params.accountManagerUid) q = q.where('accountManagerUid', '==', params.accountManagerUid)
  if (params.tags && params.tags.length > 0) q = q.where('tags', 'array-contains-any', params.tags.slice(0, 10))
  const orderField = params.orderBy === 'name-asc' ? 'name' : params.orderBy === 'updatedAt-desc' ? 'updatedAt' : 'createdAt'
  const orderDir = params.orderBy === 'name-asc' ? 'asc' : 'desc'
  q = q.orderBy(orderField, orderDir)
  q = q.limit(Math.min(params.limit ?? 50, 200))
  return q
}

export function applyPostFilterSearch(companies: Company[], search: string): Company[] {
  if (!search.trim()) return companies
  const needle = search.toLowerCase().trim()
  return companies.filter(c =>
    c.name?.toLowerCase().includes(needle) ||
    c.domain?.toLowerCase().includes(needle) ||
    c.website?.toLowerCase().includes(needle)
  )
}
