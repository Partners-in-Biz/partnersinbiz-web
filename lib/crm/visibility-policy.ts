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
  sharedWithUserIds?: string[]
  createdBy?: string
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

const CLIENT_DOCUMENT_VISIBLE_STATUSES = new Set(['client_review', 'changes_requested', 'approved', 'accepted'])

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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isClientDocumentRow(row: RowWithVisibility): boolean {
  return Boolean(row.templateId || row.currentVersionId || row.shareToken || row.approvalMode)
}

function actorOwnsOrIsSharedDocument(row: RowWithVisibility, actorUid: string): boolean {
  if (!actorUid) return false
  if (cleanString(row.createdBy) === actorUid) return true
  if (includesClean(row.sharedWithUserIds, actorUid)) return true
  if (includesClean(row.allowedUserIds, actorUid)) return true
  return false
}

function clientDocumentVisibility(row: RowWithVisibility, ctx: VisibilityContext): boolean | null {
  if (!isClientDocumentRow(row)) return null
  if (row.deleted === true || row.archived === true || row.status === 'archived') return false

  const actorUid = ctx.actor?.uid || ctx.user?.uid || ''
  // Creator / explicit share always keep access (including internal drafts created via agent assist).
  if (actorOwnsOrIsSharedDocument(row, actorUid)) return true

  // Everyone else only sees client-facing statuses.
  if (!CLIENT_DOCUMENT_VISIBLE_STATUSES.has(cleanString(row.status))) return false

  const linked = recordValue(row.linked)
  if (cleanString(row.orgId) === ctx.orgId) return true
  if (cleanString(linked.clientOrgId) === ctx.orgId) return true
  if (includesClean(row.allowedOrgIds, ctx.orgId)) return true

  return false
}

/**
 * Company command-center documents are already company-scoped and the route
 * already checked CRM company access. Holder-team members who can open the
 * company see the full document workspace (internal + sent). Recipient-only
 * filtering belongs on client portal document lists, not CRM company pages.
 */
function companyCommandCenterDocumentAllowed(row: RowWithVisibility, ctx: VisibilityContext): boolean {
  if (row.deleted === true || row.archived === true || row.status === 'archived') return false
  if (!isClientDocumentRow(row)) {
    return rowAllowed(row, ctx)
  }
  // Company-scoped list: show all non-archived client documents on the account.
  return true
}

function rowAllowed(row: RowWithVisibility, ctx: VisibilityContext): boolean {
  const clientDocumentAllowed = clientDocumentVisibility(row, ctx)
  if (clientDocumentAllowed !== null) return clientDocumentAllowed

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
    research: true,
    properties: true,
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
    documents: policy.documents
      ? (center.documents as RowWithVisibility[]).filter((row) => companyCommandCenterDocumentAllowed(row, ctx))
      : [],
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
