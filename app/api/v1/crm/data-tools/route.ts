import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { sanitizeCompanyForWrite } from '@/lib/companies/store'
import type { CompanyInput } from '@/lib/companies/types'
import { sanitizeContactForWrite } from '@/lib/crm/contacts'
import { canAccessModule, recordScopeFor } from '@/lib/orgMembers/access-policy'

export const dynamic = 'force-dynamic'

type ResourceName = 'companies' | 'contacts' | 'relationships' | 'products' | 'inventory'
type DataRow = { id?: string; [key: string]: unknown }

const RESOURCE_CONFIG: Record<ResourceName, { collection: string; orgField: string }> = {
  companies: { collection: 'companies', orgField: 'orgId' },
  contacts: { collection: 'contacts', orgField: 'orgId' },
  relationships: { collection: 'businessRelationships', orgField: 'sourceOrgId' },
  products: { collection: 'products', orgField: 'orgId' },
  inventory: { collection: 'inventoryItems', orgField: 'orgId' },
}

function resourceConfig(value: unknown) {
  const key = typeof value === 'string' ? value.trim() as ResourceName : 'companies'
  return RESOURCE_CONFIG[key] ? { key, ...RESOURCE_CONFIG[key] } : null
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDomain(value: unknown): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

function duplicateKey(resource: ResourceName, row: DataRow): string {
  if (resource === 'companies') return normalizeDomain(row.domain ?? row.website) || cleanString(row.name).toLowerCase()
  if (resource === 'contacts') return cleanString(row.email).toLowerCase() || `${cleanString(row.name).toLowerCase()}|${cleanString(row.companyId)}`
  if (resource === 'relationships') return [
    cleanString(row.sourceCompanyId),
    cleanString(row.targetOrgId),
    cleanString(row.targetCompanyId),
    cleanString(row.relationshipType),
  ].join('|')
  if (resource === 'products') return cleanString(row.sku).toLowerCase() || cleanString(row.name).toLowerCase()
  return cleanString(row.sku).toLowerCase() || `${cleanString(row.name).toLowerCase()}|${cleanString(row.location)}`
}

async function listRows(collection: string, orgField: string, orgId: string): Promise<DataRow[]> {
  const snap = await adminDb.collection(collection).where(orgField, '==', orgId).limit(5000).get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as DataRow)
    .filter((row) => row.deleted !== true && row.archived !== true)
}

function parseBodyRows(body: Record<string, unknown>): DataRow[] {
  return Array.isArray(body.rows)
    ? body.rows.filter((row): row is DataRow => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
    : []
}

function sanitizeImportRow(resource: ResourceName, row: DataRow): DataRow {
  if (resource === 'companies') return sanitizeCompanyForWrite(row as Partial<CompanyInput>) as DataRow
  if (resource === 'contacts') return sanitizeContactForWrite(row) as DataRow
  return row
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const config = resourceConfig(url.searchParams.get('resource'))
  if (!config) return apiError('Unsupported CRM data resource', 400)
  const orgId = url.searchParams.get('orgId')?.trim() || user.orgId
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const rows = await listRows(config.collection, config.orgField, orgId)
  return apiSuccess({ resource: config.key, rows, count: rows.length })
})

export const POST = withAuth('admin', async (req, user) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON body', 400)

  const config = resourceConfig((body as Record<string, unknown>).resource)
  if (!config) return apiError('Unsupported CRM data resource', 400)
  const orgId = cleanString((body as Record<string, unknown>).orgId) || user.orgId
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!canAccessModule(user.memberAccessPolicy, 'crm')) return apiError('CRM module access is disabled for this team member', 403)

  const action = cleanString((body as Record<string, unknown>).action) || 'dedupe'
  if (action === 'import') {
    if (config.key !== 'companies' && config.key !== 'contacts') {
      return apiError('CRM data imports are only supported for companies and contacts', 400)
    }
    const rows = parseBodyRows(body as Record<string, unknown>)
    const dryRun = (body as Record<string, unknown>).dryRun !== false
    if (!dryRun && (body as Record<string, unknown>).approved !== true) {
      return apiError('approved: true is required before applying imports', 400)
    }
    if (dryRun) {
      return apiSuccess({ resource: config.key, dryRun: true, createdCount: 0, updateCount: 0, rows })
    }

    let createdCount = 0
    const scopedRecords = recordScopeFor(user.memberAccessPolicy, 'crm') === 'owned_or_linked'
    for (const row of rows) {
      const sanitized = sanitizeImportRow(config.key, row)
      const ownership = scopedRecords && user.uid
        ? config.key === 'companies'
          ? { ownerUid: user.uid, allowedUserIds: [user.uid] }
          : { assignedTo: user.uid, allowedUserIds: [user.uid] }
        : {}
      const toWrite = {
        ...sanitized,
        ...ownership,
        [config.orgField]: orgId,
        source: config.key === 'contacts' ? 'import' : sanitized.source,
        createdBy: user.role === 'ai' ? undefined : user.uid,
        updatedBy: user.role === 'ai' ? undefined : user.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        deleted: false,
      }
      await adminDb.collection(config.collection).add(Object.fromEntries(Object.entries(toWrite).filter(([, value]) => value !== undefined)))
      createdCount += 1
    }
    return apiSuccess({ resource: config.key, dryRun: false, createdCount, updateCount: 0 })
  }

  if (action === 'dedupe') {
    const rows = await listRows(config.collection, config.orgField, orgId)
    const groups = new Map<string, DataRow[]>()
    for (const row of rows) {
      const key = duplicateKey(config.key, row)
      if (!key) continue
      const group = groups.get(key) ?? []
      group.push(row)
      groups.set(key, group)
    }
    const duplicateGroups = Array.from(groups.values())
      .filter((group) => group.length > 1)
      .map((group) => ({
        ids: group.map((row) => cleanString(row.id)),
        rows: group,
      }))
    return apiSuccess({ resource: config.key, duplicateGroups, duplicateGroupCount: duplicateGroups.length })
  }

  return apiError('Unsupported CRM data tool action', 400)
})
