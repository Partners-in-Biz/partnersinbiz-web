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
    attention: {
      overdueInvoices,
      lowStockItems,
      openOrders,
    },
  }
}
