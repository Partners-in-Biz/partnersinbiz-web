import { adminDb } from '@/lib/firebase/admin'
import type { PartnerResourceType } from './types'
import { PREJOIN_RESOURCE_ADAPTERS } from './prejoin-resource-adapter'

/**
 * Server-side immutable owner lookup for pre-join invitation issuance.
 * Caller-supplied owner/org claims are ignored. Missing/deleted/ownerless
 * records are not shareable.
 */
const COLLECTION_FOR_RESOURCE_TYPE: Partial<Record<PartnerResourceType, string>> = Object.fromEntries(
  PREJOIN_RESOURCE_ADAPTERS.map((adapter) => [adapter.resourceType, adapter.collection]),
)

function ownerOrgIdFromRecord(record: Record<string, unknown>): string | null {
  for (const key of ['ownerOrgId', 'sourceOrgId', 'issuerOrgId', 'orgId'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      if (record.deleted === true || record.deletedAt) return null
      return value.trim()
    }
  }
  return null
}

export async function loadPrejoinResourceOwner(
  resourceType: PartnerResourceType,
  resourceId: string,
): Promise<string | null> {
  const id = typeof resourceId === 'string' ? resourceId.trim() : ''
  if (!id || id !== resourceId) return null
  const collection = COLLECTION_FOR_RESOURCE_TYPE[resourceType]
  if (!collection) return null
  const snapshot = await adminDb.collection(collection).doc(id).get()
  if (!snapshot.exists) return null
  return ownerOrgIdFromRecord((snapshot.data() ?? {}) as Record<string, unknown>)
}
