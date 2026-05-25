import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  buildOrgDashboardAggregate,
  getOrganizationForDashboard,
} from '@/lib/org-dashboard/aggregate'

export const dynamic = 'force-dynamic'

async function resolveRequestedOrgId(req: NextRequest): Promise<string | null> {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')?.trim()
  if (orgId) return orgId

  const orgSlug = searchParams.get('orgSlug')?.trim()
  if (!orgSlug) return null

  const snap = await adminDb
    .collection('organizations')
    .where('slug', '==', orgSlug)
    .limit(1)
    .get()

  if (snap.empty) return '__org_slug_not_found__'
  return snap.docs[0].id
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const requestedOrgId = await resolveRequestedOrgId(req)
  if (requestedOrgId === '__org_slug_not_found__') return apiError('Organization not found', 404)

  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (!canAccessOrg(user, scope.orgId)) return apiError('Forbidden', 403)

  const org = await getOrganizationForDashboard(scope.orgId)
  if (!org) return apiError('Organization not found', 404)

  const dashboard = await buildOrgDashboardAggregate(org)
  return apiSuccess(dashboard)
})
