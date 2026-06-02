import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import type { Property } from '@/lib/properties/types'

export class AnalyticsPropertyAccessError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AnalyticsPropertyAccessError'
    this.status = status
  }
}

export function analyticsPropertyErrorResponse(error: unknown): Response | null {
  if (error instanceof AnalyticsPropertyAccessError) {
    return apiError(error.message, error.status)
  }
  return null
}

export async function requireAnalyticsProperty(
  user: ApiUser,
  input: { propertyId: string; orgId?: string | null },
): Promise<Property> {
  const propertyId = input.propertyId?.trim()
  if (!propertyId) {
    throw new AnalyticsPropertyAccessError('propertyId is required', 400)
  }

  const snap = await adminDb.collection('properties').doc(propertyId).get()
  if (!snap.exists || snap.data()?.deleted) {
    throw new AnalyticsPropertyAccessError('Property not found', 404)
  }

  const property = { id: snap.id, ...snap.data() } as Property
  if (input.orgId && property.orgId !== input.orgId) {
    throw new AnalyticsPropertyAccessError('propertyId does not belong to orgId', 400)
  }

  if (!canAccessOrg(user, property.orgId)) {
    throw new AnalyticsPropertyAccessError('Forbidden', 403)
  }

  return property
}
