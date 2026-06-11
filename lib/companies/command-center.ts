import { adminDb } from '@/lib/firebase/admin'
import type { Company } from '@/lib/companies/types'
import { listBusinessRelationships } from '@/lib/business-relationships/store'
import type { BusinessRelationship } from '@/lib/business-relationships/types'
import { listServiceWorkspaces } from '@/lib/service-workspaces/store'
import type { ServiceWorkspace } from '@/lib/service-workspaces/types'
import { listInventoryItems, listOrders, listShipments } from '@/lib/commerce/store'
import type { InventoryItem, Order, Shipment } from '@/lib/commerce/types'

export type CommandCenterRow = { id: string; [key: string]: unknown }

export type LinkedWorkspace = {
  id: string
  orgId: string
  slug: string
  orgSlug: string
  name: string
}

export interface CompanyCommandCenter {
  company: Company
  linkedWorkspace: LinkedWorkspace | null
  summary: {
    contacts: number
    deals: number
    projects: number
    documents: number
    serviceWorkspaces: number
    relationships: number
    quotes: number
    invoices: number
    orders: number
    shipments: number
    inventoryItems: number
    openOrders: number
    lowStockItems: number
    overdueInvoices: number
  }
  analytics: {
    accountValue: number
    weightedPipelineValue: number
    trackedOrderValue: number
    openProjectCount: number
    activeServiceCount: number
    collaborationCount: number
    riskSignals: string[]
  }
  contacts: CommandCenterRow[]
  deals: CommandCenterRow[]
  projects: CommandCenterRow[]
  documents: CommandCenterRow[]
  serviceWorkspaces: ServiceWorkspace[]
  relationships: BusinessRelationship[]
  quotes: CommandCenterRow[]
  invoices: CommandCenterRow[]
  orders: Order[]
  shipments: Shipment[]
  inventoryItems: InventoryItem[]
  activities: CommandCenterRow[]
}

export interface CommandCenterOptions {
  limit?: number
}

export type ContactLinkSubject = {
  id: string
  orgId?: string
  linkedOrgId?: string
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

function limitValue(value: unknown, fallback = 50): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), 200)
}

function timeValue(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function rowIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(cleanString).filter(Boolean)
}

function activeRelationshipsFor(company: Company, relationships: BusinessRelationship[] = []) {
  return relationships.filter((relationship) => (
    relationship.deleted !== true &&
    relationship.status === 'active' &&
    (relationship.sourceCompanyId === company.id || relationship.targetCompanyId === company.id)
  ))
}

// SANCTIONED CROSS-ORG READ (portal-first convergence spec §7.2).
// This module is the only place allowed to read across org boundaries:
// a company command center may aggregate counts/statuses from the org the
// company is LINKED to (company.linkedOrgId) and from active business
// relationships — never raw records from unrelated orgs. Any new cross-org
// read elsewhere in the codebase is a spec violation; add it here or stop
// and ask.
function documentCandidateOrgIds(company: Company, relationships: BusinessRelationship[] = []): string[] {
  const activeRelationships = activeRelationshipsFor(company, relationships)
  const orgIds = new Set<string>([company.orgId])
  const linkedOrgId = cleanString(company.linkedOrgId)
  if (linkedOrgId) orgIds.add(linkedOrgId)

  for (const relationship of activeRelationships) {
    const row = relationship as BusinessRelationship & { sourceOrgId?: string }
    const sourceOrgId = cleanString(row.sourceOrgId)
    const targetOrgId = cleanString(row.targetOrgId)
    if (sourceOrgId) orgIds.add(sourceOrgId)
    if (targetOrgId) orgIds.add(targetOrgId)
  }

  return Array.from(orgIds)
}

function matchesAny(value: unknown, allowed: Set<string>): boolean {
  const direct = cleanString(value)
  return Boolean(direct && allowed.has(direct))
}

function matchesAnyArray(value: unknown, allowed: Set<string>): boolean {
  return rowIdList(value).some((entry) => allowed.has(entry))
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function companyLinkSets(company: Company, relationships: BusinessRelationship[] = []) {
  const activeRelationships = activeRelationshipsFor(company, relationships)
  const companyIds = new Set<string>([company.id])
  const orgIds = new Set<string>()
  const relationshipIds = new Set<string>()
  const linkedOrgId = cleanString(company.linkedOrgId)
  if (linkedOrgId) orgIds.add(linkedOrgId)

  for (const relationship of activeRelationships) {
    if (relationship.id) relationshipIds.add(relationship.id)
    const sourceCompanyId = cleanString(relationship.sourceCompanyId)
    const targetCompanyId = cleanString(relationship.targetCompanyId)
    const targetOrgId = cleanString(relationship.targetOrgId)
    if (sourceCompanyId) companyIds.add(sourceCompanyId)
    if (targetCompanyId) companyIds.add(targetCompanyId)
    if (targetOrgId) orgIds.add(targetOrgId)
  }

  return { companyIds, orgIds, relationshipIds }
}

function linksCompanyByFields(
  row: Record<string, unknown>,
  company: Company,
  relationships: BusinessRelationship[] = [],
  scalarFields: unknown[] = [],
  arrayFields: unknown[] = [],
): boolean {
  const { companyIds, orgIds, relationshipIds } = companyLinkSets(company, relationships)

  if (scalarFields.some((value) => matchesAny(value, companyIds))) return true
  if (arrayFields.some((value) => matchesAnyArray(value, companyIds))) return true
  if (relationshipIds.size > 0 && matchesAny(row.relationshipId, relationshipIds)) return true

  if (orgIds.size > 0) {
    const linked = recordValue(row.linked)
    const linkedFields = [
      linked.clientOrgId,
      row.recipientOrgId,
      row.targetOrgId,
      row.clientOrgId,
      row.legacyOrgId,
      row.linkedOrgId,
    ]
    if (linkedFields.some((value) => matchesAny(value, orgIds))) return true
    if (matchesAnyArray(row.allowedOrgIds, orgIds)) return true
  }

  return false
}

export function documentLinksCompany(row: Record<string, unknown>, company: Company, relationships: BusinessRelationship[] = []): boolean {
  const linked = recordValue(row.linked)
  return linksCompanyByFields(row, company, relationships, [
    row.companyId,
    linked.companyId,
    row.sourceCompanyId,
    linked.sourceCompanyId,
    row.clientCompanyId,
    row.targetCompanyId,
    row.relationshipCompanyId,
  ], [
    row.companyIds,
    linked.companyIds,
    row.sourceCompanyIds,
    linked.sourceCompanyIds,
  ])
}

export function projectLinksCompany(row: Record<string, unknown>, company: Company, relationships: BusinessRelationship[] = []): boolean {
  const linked = recordValue(row.linked)
  return linksCompanyByFields(row, company, relationships, [
    row.companyId,
    row.sourceCompanyId,
    linked.companyId,
    linked.sourceCompanyId,
  ], [
    row.companyIds,
    row.sourceCompanyIds,
    linked.companyIds,
    linked.sourceCompanyIds,
  ])
}

function contactId(subject: string | ContactLinkSubject): string {
  return typeof subject === 'string' ? subject : cleanString(subject.id)
}

export function documentLinksContact(row: Record<string, unknown>, contact: string | ContactLinkSubject): boolean {
  const id = contactId(contact)
  if (!id) return false
  const allowed = new Set<string>([id])
  const linked = recordValue(row.linked)
  return [row.contactId, row.sourceContactId, linked.contactId, linked.sourceContactId]
    .some((value) => matchesAny(value, allowed)) ||
    [row.contactIds, row.sourceContactIds, linked.contactIds, linked.sourceContactIds]
      .some((value) => matchesAnyArray(value, allowed))
}

export function projectLinksContact(row: Record<string, unknown>, contact: string | ContactLinkSubject): boolean {
  const id = contactId(contact)
  if (!id) return false
  const allowed = new Set<string>([id])
  const linked = recordValue(row.linked)
  return [row.contactId, row.sourceContactId, linked.contactId, linked.sourceContactId]
    .some((value) => matchesAny(value, allowed)) ||
    [row.contactIds, row.sourceContactIds, linked.contactIds, linked.sourceContactIds]
      .some((value) => matchesAnyArray(value, allowed))
}

export function matchesCompany(row: Record<string, unknown>, company: Company, relationships: BusinessRelationship[] = []): boolean {
  return documentLinksCompany(row, company, relationships) || projectLinksCompany(row, company, relationships)
}

function sortRows(rows: CommandCenterRow[], limit: number): CommandCenterRow[] {
  return rows
    .filter((row) => row.deleted !== true && row.archived !== true)
    .sort((a, b) => timeValue(b.updatedAt ?? b.createdAt ?? b.issueDate) - timeValue(a.updatedAt ?? a.createdAt ?? a.issueDate))
    .slice(0, limit)
}

async function listOrgRows(collectionName: string, orgId: string, limit = 1000): Promise<CommandCenterRow[]> {
  const snap = await adminDb.collection(collectionName).where('orgId', '==', orgId).limit(limit).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

async function loadLinkedWorkspace(company: Company): Promise<LinkedWorkspace | null> {
  const linkedOrgId = cleanString(company.linkedOrgId)
  if (!linkedOrgId) return null

  const snap = await adminDb.collection('organizations').doc(linkedOrgId).get()
  if (!snap.exists) {
    return {
      id: linkedOrgId,
      orgId: linkedOrgId,
      slug: linkedOrgId,
      orgSlug: linkedOrgId,
      name: linkedOrgId,
    }
  }

  const data = snap.data() ?? {}
  const slug = cleanString(data.slug) || linkedOrgId
  const name = cleanString(data.name) || cleanString(data.displayName) || slug

  return {
    id: linkedOrgId,
    orgId: linkedOrgId,
    slug,
    orgSlug: slug,
    name,
  }
}

export async function listCompanyProjects(company: Company, options: CommandCenterOptions = {}): Promise<CommandCenterRow[]> {
  const limit = limitValue(options.limit)
  const [rows, relationships] = await Promise.all([
    listOrgRows('projects', company.orgId, 1000),
    listBusinessRelationships(company.orgId, { companyId: company.id, status: 'active', limit: 500 }),
  ])
  return sortRows(rows.filter((row) => projectLinksCompany(row, company, relationships)), limit)
}

async function listCompanyRows(collectionName: string, company: Company, options: CommandCenterOptions = {}): Promise<CommandCenterRow[]> {
  const limit = limitValue(options.limit)
  const rows = await listOrgRows(collectionName, company.orgId, 1000)
  return sortRows(rows.filter((row) => matchesCompany(row, company)), limit)
}

export async function listCompanyDocuments(company: Company, options: CommandCenterOptions = {}): Promise<CommandCenterRow[]> {
  const limit = limitValue(options.limit)
  const relationships = await listBusinessRelationships(company.orgId, {
    companyId: company.id,
    status: 'active',
    limit: 500,
  })
  const candidateRows = await Promise.all(
    documentCandidateOrgIds(company, relationships).map((orgId) => listOrgRows('client_documents', orgId, 1000)),
  )
  const byId = new Map<string, CommandCenterRow>()
  for (const row of candidateRows.flat()) {
    byId.set(row.id, row)
  }

  return sortRows(Array.from(byId.values()).filter((row) => documentLinksCompany(row, company, relationships)), limit)
}

export async function listContactProjects(contact: ContactLinkSubject, options: CommandCenterOptions = {}): Promise<CommandCenterRow[]> {
  const limit = limitValue(options.limit)
  const orgId = cleanString(contact.orgId)
  if (!orgId) return []
  const rows = await listOrgRows('projects', orgId, 1000)
  return sortRows(rows.filter((row) => projectLinksContact(row, contact)), limit)
}

export async function listContactDocuments(contact: ContactLinkSubject, options: CommandCenterOptions = {}): Promise<CommandCenterRow[]> {
  const limit = limitValue(options.limit)
  const orgIds = new Set<string>()
  const orgId = cleanString(contact.orgId)
  const linkedOrgId = cleanString(contact.linkedOrgId)
  if (orgId) orgIds.add(orgId)
  if (linkedOrgId) orgIds.add(linkedOrgId)
  const candidateRows = await Promise.all(Array.from(orgIds).map((id) => listOrgRows('client_documents', id, 1000)))
  const byId = new Map<string, CommandCenterRow>()
  for (const row of candidateRows.flat()) {
    byId.set(row.id, row)
  }
  return sortRows(Array.from(byId.values()).filter((row) => documentLinksContact(row, contact)), limit)
}

function isOpenOrder(order: Order): boolean {
  return !['fulfilled', 'cancelled', 'archived'].includes(order.status)
}

function isLowStock(item: InventoryItem): boolean {
  if (item.status === 'low_stock' || item.status === 'out_of_stock') return true
  return numericValue(item.lowStockThreshold) > 0 && numericValue(item.quantityAvailable) <= numericValue(item.lowStockThreshold)
}

export async function buildCompanyCommandCenter(
  company: Company,
  options: CommandCenterOptions = {},
): Promise<CompanyCommandCenter> {
  const limit = limitValue(options.limit)
  const [
    contacts,
    deals,
    projects,
    documents,
    serviceWorkspaces,
    relationships,
    quotes,
    invoices,
    orders,
    shipments,
    inventoryItems,
    activities,
    linkedWorkspace,
  ] = await Promise.all([
    listCompanyRows('contacts', company, { limit }),
    listCompanyRows('deals', company, { limit }),
    listCompanyProjects(company, { limit }),
    listCompanyDocuments(company, { limit }),
    listServiceWorkspaces(company.orgId, { companyId: company.id, limit }),
    listBusinessRelationships(company.orgId, { companyId: company.id, limit }),
    listCompanyRows('quotes', company, { limit }),
    listCompanyRows('invoices', company, { limit }),
    listOrders(company.orgId, { companyId: company.id, limit }),
    listShipments(company.orgId, { companyId: company.id, limit }),
    listInventoryItems(company.orgId, { companyId: company.id, limit }),
    listCompanyRows('activities', company, { limit }),
    loadLinkedWorkspace(company),
  ])

  const openOrders = orders.filter(isOpenOrder)
  const lowStockItems = inventoryItems.filter(isLowStock)
  const overdueInvoices = invoices.filter((invoice) => cleanString(invoice.status) === 'overdue')
  const weightedPipelineValue = deals.reduce((sum, deal) => sum + numericValue(deal.value) * (numericValue(deal.probability) || 100) / 100, 0)
  const trackedOrderValue = orders.reduce((sum, order) => sum + numericValue(order.total), 0)
  const accountValue = deals.reduce((sum, deal) => sum + numericValue(deal.value), 0) + trackedOrderValue
  const riskSignals = [
    overdueInvoices.length > 0 ? `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? '' : 's'}` : '',
    lowStockItems.length > 0 ? `${lowStockItems.length} low-stock item${lowStockItems.length === 1 ? '' : 's'}` : '',
    projects.some((project) => cleanString(project.status) === 'blocked') ? 'Blocked project work' : '',
  ].filter(Boolean)

  return {
    company,
    linkedWorkspace,
    summary: {
      contacts: contacts.length,
      deals: deals.length,
      projects: projects.length,
      documents: documents.length,
      serviceWorkspaces: serviceWorkspaces.length,
      relationships: relationships.length,
      quotes: quotes.length,
      invoices: invoices.length,
      orders: orders.length,
      shipments: shipments.length,
      inventoryItems: inventoryItems.length,
      openOrders: openOrders.length,
      lowStockItems: lowStockItems.length,
      overdueInvoices: overdueInvoices.length,
    },
    analytics: {
      accountValue,
      weightedPipelineValue,
      trackedOrderValue,
      openProjectCount: projects.filter((project) => !['completed', 'archived', 'live'].includes(cleanString(project.status))).length,
      activeServiceCount: serviceWorkspaces.filter((workspace) => workspace.status === 'active').length,
      collaborationCount: relationships.filter((relationship) => relationship.status === 'active').length,
      riskSignals,
    },
    contacts,
    deals,
    projects,
    documents,
    serviceWorkspaces,
    relationships,
    quotes,
    invoices,
    orders,
    shipments,
    inventoryItems,
    activities,
  }
}
