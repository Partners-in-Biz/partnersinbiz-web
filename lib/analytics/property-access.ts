import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import type { Property } from '@/lib/properties/types'
import {
  assertMarketingHandlerAccess,
  extractPartnerLinkId,
} from '@/lib/cross-org/marketing-handler-access'
import type { NextRequest } from 'next/server'

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
  input: {
    propertyId: string
    orgId?: string | null
    /** When provided, enables PartnerLink-based reporting_view collaboration. */
    req?: NextRequest | null
    partnerLinkId?: string | null
    operation?: 'read' | 'reporting_view'
  },
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

  // Fast path: ordinary same-org / platform-admin access.
  if (canAccessOrg(user, property.orgId)) {
    return property
  }

  // Cross-org collaboration: reporting_view only (never configure/spend).
  const partnerLinkId =
    input.partnerLinkId
    ?? extractPartnerLinkId(input.req ?? null)
  const access = await assertMarketingHandlerAccess({
    user,
    module: 'analytics',
    resourceId: propertyId,
    resourceOwnerOrgId: property.orgId,
    operation: input.operation ?? 'reporting_view',
    partnerLinkId,
  })
  if (!access.ok) {
    throw new AnalyticsPropertyAccessError(access.error, access.status)
  }

  return property
}
