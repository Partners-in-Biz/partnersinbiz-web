// lib/companies/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { Currency } from '@/lib/crm/types'

export type CompanySize = '1-10' | '11-50' | '51-200' | '201-1000' | '1000+'
export type CompanyTier = 'enterprise' | 'mid-market' | 'smb'
export type CompanyLifecycleStage = 'lead' | 'prospect' | 'customer' | 'churned'

export interface CompanyAddress {
  street?: string
  city?: string
  state?: string
  country?: string
  postalCode?: string
  label?: string  // 'hq', 'billing', 'shipping', etc.
}

export interface SocialProfiles {
  linkedin?: string
  twitter?: string
  facebook?: string
  instagram?: string
}

export interface Company {
  id: string
  orgId: string
  // Identity
  name: string
  domain?: string         // primary domain (acme.com); used for fuzzy auto-match
  website?: string
  industry?: string       // free-form for now; A2 will add per-org taxonomies
  // Size & financials
  size?: CompanySize
  employeeCount?: number
  annualRevenue?: number
  currency?: Currency     // for annualRevenue
  tier?: CompanyTier
  // Lifecycle
  lifecycleStage?: CompanyLifecycleStage
  tags: string[]          // default []
  notes: string           // default ''
  // Contact info
  phone?: string
  address?: CompanyAddress
  secondaryAddresses?: CompanyAddress[]
  socialProfiles?: SocialProfiles
  // Branding
  logoUrl?: string        // Firebase Storage upload OR external URL
  // Relationships
  linkedOrgId?: string       // external PiB client org this sender-owned CRM company represents
  parentCompanyId?: string  // subsidiary tree (same org only — enforced at write)
  accountManagerUid?: string
  accountManagerRef?: MemberRef
  // Health & custom
  healthScore?: number    // 0-100, nullable until A6 lifecycle automation
  customFields?: Record<string, unknown>  // A2 will add definitions
  // Attribution (standard CRM pattern)
  ownerUid?: string
  ownerRef?: MemberRef
  createdBy?: string
  createdByRef?: MemberRef
  updatedBy?: string
  updatedByRef?: MemberRef
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted?: boolean
}

export type CompanyInput = Omit<Company, 'id' | 'createdAt' | 'updatedAt'>

export interface CompanyListParams {
  orgId?: string
  search?: string
  industry?: string
  size?: CompanySize
  tier?: CompanyTier
  lifecycleStage?: CompanyLifecycleStage
  tags?: string[]
  accountManagerUid?: string
  hasOpenDeals?: boolean
  limit?: number
  cursor?: string
  orderBy?: 'createdAt-desc' | 'name-asc' | 'updatedAt-desc'
}

export const COMPANY_BULK_FIELDS = ['accountManagerUid', 'ownerUid', 'tags', 'tier', 'lifecycleStage', 'industry', 'size'] as const
export type CompanyBulkField = typeof COMPANY_BULK_FIELDS[number]
