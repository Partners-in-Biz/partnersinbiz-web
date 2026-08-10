/**
 * POST /api/v1/admin/agent-org/seed
 *
 * Seed the default AgentOrgNode org chart for an org (idempotent — no-op when
 * the org already has nodes). Auth: admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { seedOrgChart } from '@/lib/agent-org/seed'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const result = await seedOrgChart(scope.orgId)
  if (!result.ok) return apiError(result.error ?? 'Seeding failed', 500)

  return apiSuccess({ created: result.created, skipped: result.skipped })
})
