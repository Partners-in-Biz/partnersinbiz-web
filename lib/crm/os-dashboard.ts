import { adminDb } from '@/lib/firebase/admin'

type Row = { id: string; [key: string]: unknown }

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

async function listOrgRows(collectionName: string, orgId: string): Promise<Row[]> {
  const snap = await adminDb.collection(collectionName).where('orgId', '==', orgId).limit(1000).get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Row)
    .filter((row) => row.deleted !== true && row.archived !== true)
}

export async function buildCrmOsDashboard(orgId: string) {
  const [
    companies,
    contacts,
    deals,
    projects,
    documents,
    serviceWorkspaces,
    orders,
    shipments,
    inventoryItems,
    invoices,
    relationshipsSnap,
  ] = await Promise.all([
    listOrgRows('companies', orgId),
    listOrgRows('contacts', orgId),
    listOrgRows('deals', orgId),
    listOrgRows('projects', orgId),
    listOrgRows('client_documents', orgId),
    listOrgRows('serviceWorkspaces', orgId),
    listOrgRows('orders', orgId),
    listOrgRows('shipments', orgId),
    listOrgRows('inventoryItems', orgId),
    listOrgRows('invoices', orgId),
    adminDb.collection('businessRelationships').where('sourceOrgId', '==', orgId).limit(1000).get(),
  ])

  const relationships = relationshipsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Row)
    .filter((row) => row.deleted !== true && row.status !== 'archived')
  const openOrders = orders.filter((order) => !['fulfilled', 'cancelled', 'archived'].includes(String(order.status ?? '')))
  const overdueInvoices = invoices.filter((invoice) => invoice.status === 'overdue')
  const lowStockItems = inventoryItems.filter((item) => {
    if (item.status === 'low_stock' || item.status === 'out_of_stock') return true
    return numericValue(item.lowStockThreshold) > 0 && numericValue(item.quantityAvailable) <= numericValue(item.lowStockThreshold)
  })
  const pipelineValue = deals.reduce((sum, deal) => sum + numericValue(deal.value), 0)
  const orderValue = orders.reduce((sum, order) => sum + numericValue(order.total), 0)
  const cohorts = {
    lifecycle: companies.reduce<Record<string, number>>((acc, company) => {
      const key = cleanString(company.lifecycleStage) || cleanString(company.status) || 'unknown'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {}),
  }
  const serviceProfitability = serviceWorkspaces.reduce<{
    byServiceType: Record<string, { revenue: number; cost: number; grossProfit: number; grossMargin: number; count: number }>
    totalRevenue: number
    totalCost: number
    grossProfit: number
    grossMargin: number
  }>((acc, workspace) => {
    const serviceType = cleanString(workspace.serviceType) || 'custom'
    const revenue = numericValue(workspace.revenue) || numericValue(workspace.budget)
    const cost = numericValue(workspace.actualCost) || numericValue(workspace.costTotal)
    const current = acc.byServiceType[serviceType] ?? { revenue: 0, cost: 0, grossProfit: 0, grossMargin: 0, count: 0 }
    current.revenue += revenue
    current.cost += cost
    current.grossProfit += revenue - cost
    current.grossMargin = current.revenue > 0 ? Math.round((current.grossProfit / current.revenue) * 10000) / 100 : 0
    current.count += 1
    acc.byServiceType[serviceType] = current
    acc.totalRevenue += revenue
    acc.totalCost += cost
    acc.grossProfit += revenue - cost
    acc.grossMargin = acc.totalRevenue > 0 ? Math.round((acc.grossProfit / acc.totalRevenue) * 10000) / 100 : 0
    return acc
  }, { byServiceType: {}, totalRevenue: 0, totalCost: 0, grossProfit: 0, grossMargin: 0 })
  const blockedProjects = projects.filter((project) => cleanString(project.status) === 'blocked')
  const now = Date.now()
  const overdueProjects = projects.filter((project) => {
    const due = timeValue(project.slaDueAt ?? project.dueDate ?? project.expectedDeliveryDate)
    return due > 0 && due < now && !['completed', 'archived', 'live'].includes(cleanString(project.status))
  })
  const overdueShipments = shipments.filter((shipment) => {
    const due = timeValue(shipment.expectedDeliveryDate)
    return due > 0 && due < now && !['delivered', 'cancelled', 'failed'].includes(cleanString(shipment.status))
  })
  const activeRelationships = relationships.filter((relationship) => relationship.status === 'active')
  const sharedCapabilities = activeRelationships.reduce<Record<string, number>>((acc, relationship) => {
    const capabilities = Array.isArray(relationship.sharedCapabilities) ? relationship.sharedCapabilities : []
    for (const capability of capabilities) {
      const key = cleanString(capability)
      if (!key) continue
      acc[key] = (acc[key] ?? 0) + 1
    }
    return acc
  }, {})
  const portalActiveCompanies = companies.filter((company) => (
    Boolean(company.portalLastSeenAt) ||
    Boolean(company.lastPortalSeenAt) ||
    numericValue(company.portalUserCount) > 0
  ))

  return {
    orgId,
    summary: {
      companies: companies.length,
      contacts: contacts.length,
      deals: deals.length,
      projects: projects.length,
      documents: documents.length,
      serviceWorkspaces: serviceWorkspaces.length,
      orders: orders.length,
      shipments: shipments.length,
      inventoryItems: inventoryItems.length,
      activeRelationships: relationships.filter((relationship) => relationship.status === 'active').length,
      openOrders: openOrders.length,
      overdueInvoices: overdueInvoices.length,
      lowStockItems: lowStockItems.length,
      pipelineValue,
      orderValue,
      accountValue: pipelineValue + orderValue,
    },
    cohorts,
    serviceProfitability,
    slaHealth: {
      blockedProjects: blockedProjects.length,
      overdueProjects: overdueProjects.length,
      overdueShipments: overdueShipments.length,
    },
    collaborationActivity: {
      activeRelationships: activeRelationships.length,
      sharedCapabilities,
      relationshipCount: relationships.length,
    },
    portalAdoption: {
      activeCompanies: portalActiveCompanies.length,
      adoptionRate: companies.length > 0 ? Math.round((portalActiveCompanies.length / companies.length) * 10000) / 100 : 0,
    },
    attention: {
      overdueInvoices,
      lowStockItems,
      openOrders,
    },
  }
}
