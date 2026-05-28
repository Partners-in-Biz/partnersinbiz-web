import type { CrmRole } from '@/lib/auth/crm-middleware'
import type { CompanyCommandCenter, CommandCenterRow } from '@/lib/companies/command-center'
import type { BusinessRelationship, FieldSharingPolicy } from '@/lib/business-relationships/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

type VisibilityContext = {
  orgId: string
  role?: CrmRole | string
  isAgent?: boolean
  actor?: MemberRef
  user?: { uid?: string; role?: string; orgId?: string; allowedOrgIds?: string[] }
}

type RowWithVisibility = CommandCenterRow & {
  visibility?: string
  allowedOrgIds?: string[]
  allowedUserIds?: string[]
  deleted?: boolean
  archived?: boolean
  status?: string
}

const COUNT_FIELDS = [
  'contacts',
  'deals',
  'projects',
  'documents',
  'serviceWorkspaces',
  'relationships',
  'quotes',
  'invoices',
  'orders',
  'shipments',
  'inventoryItems',
] as const

function isPrivilegedContext(ctx: VisibilityContext): boolean {
  return Boolean(ctx.isAgent || ctx.role === 'system' || ctx.role === 'admin' || ctx.role === 'owner' || ctx.user?.role === 'admin')
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function includesClean(values: unknown, target: string): boolean {
  if (!target || !Array.isArray(values)) return false
  return values.some((value) => cleanString(value) === target)
}

function rowAllowed(row: RowWithVisibility, ctx: VisibilityContext): boolean {
  if (row.deleted === true || row.archived === true || row.status === 'archived') return false
  if (includesClean(row.allowedOrgIds, ctx.orgId)) return true
  const actorUid = ctx.actor?.uid || ctx.user?.uid || ''
  if (includesClean(row.allowedUserIds, actorUid)) return true

  const visibility = cleanString(row.visibility)
  if (!visibility) return !row.orgId || row.orgId === ctx.orgId
  if (visibility === 'internal' || visibility === 'private') return false
  return ['relationship', 'client_visible', 'portal', 'public', 'shared'].includes(visibility)
}

function mergeFieldPolicy(relationships: BusinessRelationship[]): Required<FieldSharingPolicy> {
  const policy: Required<FieldSharingPolicy> = {
    companyProfile: true,
    contacts: true,
    projects: true,
    documents: true,
    commerce: true,
    analytics: true,
  }

  for (const relationship of relationships) {
    if (relationship.deleted === true || relationship.status !== 'active') continue
    const next = relationship.fieldSharingPolicy
    if (!next) continue
    for (const key of Object.keys(policy) as Array<keyof FieldSharingPolicy>) {
      if (next[key] === false) policy[key] = false
    }
  }
  return policy
}

function filterRows<T extends RowWithVisibility>(rows: T[] | undefined, ctx: VisibilityContext): T[] {
  if (!Array.isArray(rows)) return []
  return rows.filter((row) => rowAllowed(row, ctx))
}

function isOpenOrder(row: RowWithVisibility): boolean {
  const status = cleanString(row.status)
  return !['fulfilled', 'cancelled', 'archived'].includes(status)
}

function isLowStock(row: RowWithVisibility): boolean {
  if (row.status === 'low_stock' || row.status === 'out_of_stock') return true
  return numericValue(row.lowStockThreshold) > 0 && numericValue(row.quantityAvailable) <= numericValue(row.lowStockThreshold)
}

function recomputeSummary(center: CompanyCommandCenter): CompanyCommandCenter['summary'] {
  const summary = { ...center.summary }
  for (const field of COUNT_FIELDS) {
    const rows = center[field]
    summary[field] = Array.isArray(rows) ? rows.length : 0
  }
  summary.openOrders = Array.isArray(center.orders) ? center.orders.filter((row) => isOpenOrder(row as unknown as RowWithVisibility)).length : 0
  summary.lowStockItems = Array.isArray(center.inventoryItems) ? center.inventoryItems.filter((row) => isLowStock(row as unknown as RowWithVisibility)).length : 0
  summary.overdueInvoices = Array.isArray(center.invoices)
    ? center.invoices.filter((row) => cleanString(row.status) === 'overdue').length
    : 0
  return summary
}

function scrubAnalytics(center: CompanyCommandCenter, analyticsAllowed: boolean): CompanyCommandCenter['analytics'] {
  if (analyticsAllowed) return { ...center.analytics }
  return {
    riskSignals: center.analytics?.riskSignals ?? [],
  } as CompanyCommandCenter['analytics']
}

export function filterCompanyCommandCenterForVisibility(
  center: CompanyCommandCenter,
  ctx: VisibilityContext,
): CompanyCommandCenter {
  if (isPrivilegedContext(ctx)) return center

  const relationships = filterRows(center.relationships as unknown as RowWithVisibility[], ctx) as unknown as BusinessRelationship[]
  const policy = mergeFieldPolicy(relationships.length > 0 ? relationships : center.relationships ?? [])

  const filtered: CompanyCommandCenter = {
    ...center,
    contacts: policy.contacts ? filterRows(center.contacts as RowWithVisibility[], ctx) : [],
    deals: policy.commerce ? filterRows(center.deals as RowWithVisibility[], ctx) : [],
    projects: policy.projects ? filterRows(center.projects as RowWithVisibility[], ctx) : [],
    documents: policy.documents ? filterRows(center.documents as RowWithVisibility[], ctx) : [],
    serviceWorkspaces: filterRows(center.serviceWorkspaces as unknown as RowWithVisibility[], ctx) as unknown as CompanyCommandCenter['serviceWorkspaces'],
    relationships,
    quotes: policy.commerce ? filterRows(center.quotes as RowWithVisibility[], ctx) : [],
    invoices: policy.commerce ? filterRows(center.invoices as RowWithVisibility[], ctx) : [],
    orders: policy.commerce ? filterRows(center.orders as unknown as RowWithVisibility[], ctx) as unknown as CompanyCommandCenter['orders'] : [],
    shipments: policy.commerce ? filterRows(center.shipments as unknown as RowWithVisibility[], ctx) as unknown as CompanyCommandCenter['shipments'] : [],
    inventoryItems: policy.commerce ? filterRows(center.inventoryItems as unknown as RowWithVisibility[], ctx) as unknown as CompanyCommandCenter['inventoryItems'] : [],
    activities: filterRows(center.activities as RowWithVisibility[], ctx),
    analytics: scrubAnalytics(center, policy.analytics),
  }
  filtered.summary = recomputeSummary(filtered)
  return filtered
}
