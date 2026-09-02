/**
 * Client-safe module key lists (no firebase-admin). Used by UI matrices and
 * re-exported conceptually alongside lib/company-work/grants.ts server helpers.
 */
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'

export const COMPANY_WORKSPACE_MODULES: SharedBusinessCapability[] = [
  'crm',
  'projects',
  'documents',
  'orders',
  'shipments',
  'inventory',
  'invoices',
  'campaigns',
  'social',
  'email',
  'seo',
  'ads',
  'analytics',
  'research',
  'properties',
  'support',
  'messages',
  'services',
]

export const DEFAULT_COMPANY_WORKSPACE_MODULES: SharedBusinessCapability[] = [
  'crm',
  'projects',
  'documents',
  'campaigns',
  'social',
  'email',
  'seo',
  'ads',
  'research',
  'services',
  'support',
  'messages',
]
