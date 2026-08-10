import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import type { Property } from '@/lib/properties/types'

export type OwnerPropertyAccess =
  | { ok: true; property: Property }
  | { ok: false; response: Response }

/**
 * Loads a property only for its owning organisation. This is intentionally an
 * owner-route guard, not a cross-organisation adapter: no partner grant,
 * capability, or resource projection is accepted here.
 */
export async function loadOwnerAuthorizedProperty(
  user: ApiUser,
  propertyId: string,
): Promise<OwnerPropertyAccess> {
  const id = propertyId.trim()
  if (!id) return { ok: false, response: apiError('Property not found', 404) }

  const snap = await adminDb.collection('properties').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) {
    return { ok: false, response: apiError('Property not found', 404) }
  }

  const property = { id: snap.id, ...snap.data() } as Property
  if (!canAccessOrg(user, property.orgId)) {
    return { ok: false, response: apiError('Forbidden', 403) }
  }

  return { ok: true, property }
}
