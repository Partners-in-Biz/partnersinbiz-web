// POST /api/v1/reports/custom — build a custom report from a section spec (US-176)
//
// Body: { orgId?, spec: CustomReportSpec }
// Returns the persisted Report (with publicToken + share defaults).

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { adminDb } from '@/lib/firebase/admin'
import { buildCustomReport } from '@/lib/reports/custom'
import { normalizeSpec } from '@/lib/reports/spec-validate'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { resolveWorkScopeFromRequest } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as { orgId?: string; spec?: unknown; clientVisibility?: unknown }
  const workScope = resolveWorkScopeFromRequest({
    searchParams: new URL(req.url).searchParams,
    body: body as Record<string, unknown>,
    uid: user.uid,
  })
  const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })
  const orgId = scope.orgId

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  const tz = ((orgDoc.data() as { timezone?: string } | undefined)?.timezone) ?? 'UTC'

  const normalized = normalizeSpec(body.spec, tz)
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })

  if (normalized.spec.propertyId) {
    try {
      await requireAnalyticsProperty(user, { propertyId: normalized.spec.propertyId, orgId })
    } catch (err) {
      const propertyError = analyticsPropertyErrorResponse(err)
      if (propertyError) return propertyError
      throw err
    }
  }

  const report = await buildCustomReport({
    orgId,
    spec: normalized.spec,
    generatedBy: 'admin',
    createdBy: (user as { uid?: string })?.uid ?? 'admin',
    companyId: workScope.owner === 'company' ? workScope.companyId : undefined,
    clientVisibility: body.clientVisibility,
  })
  return NextResponse.json({ ok: true, report })
})
