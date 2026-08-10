/**
 * POST /api/v1/portal/settings/agents/org-chart/seed
 * Body: { template?: 'platform' | 'minimal' }
 * Defaults: platform for pib-platform-owner, minimal for client orgs.
 */
import { NextRequest } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { seedOrgChartForOrg } from '@/lib/agent-org/handlers'
import type { SeedTemplate } from '@/lib/agent-org/seed'

export const dynamic = 'force-dynamic'

export const POST = withPortalAuthAndRole('admin', async (req: NextRequest, _uid, orgId) => {
  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const rawTemplate = typeof body.template === 'string' ? body.template.trim() : ''
  const template: SeedTemplate | undefined =
    rawTemplate === 'platform' || rawTemplate === 'minimal' ? rawTemplate : undefined

  const result = await seedOrgChartForOrg(orgId, template)
  if (!result.ok) return apiError(result.error ?? 'Seeding failed', 500)
  return apiSuccess({
    orgId,
    created: result.created,
    skipped: result.skipped,
    template: template ?? (orgId === 'pib-platform-owner' ? 'platform' : 'minimal'),
  })
})
