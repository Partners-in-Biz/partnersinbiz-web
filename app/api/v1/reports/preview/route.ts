// POST /api/v1/reports/preview — live preview data for the custom builder (US-176)
//
// Returns computed KPIs + series for a spec WITHOUT persisting anything, so the
// builder can render metric/chart/table sections against real numbers.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { adminDb } from '@/lib/firebase/admin'
import { previewCustomReport } from '@/lib/reports/custom'
import { normalizeSpec } from '@/lib/reports/spec-validate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as { orgId?: string; spec?: unknown }
  const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })
  const orgId = scope.orgId

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  const tz = ((orgDoc.data() as { timezone?: string } | undefined)?.timezone) ?? 'UTC'

  const normalized = normalizeSpec(body.spec, tz)
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })

  const data = await previewCustomReport({ orgId, spec: normalized.spec })
  return NextResponse.json({ ok: true, ...data })
})
