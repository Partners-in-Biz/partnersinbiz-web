import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getCanvasCredits, setCanvasHiggsfieldBalance } from '@/lib/creative-canvas/credits'

export const dynamic = 'force-dynamic'

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const credits = await getCanvasCredits(orgId)
  return apiSuccess({ credits })
})

// The runtime agent (Maya) reports the live Higgsfield account balance here so
// the canvas credit chip can show the real number instead of an estimate.
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const body = await req.json().catch(() => null) as { higgsfieldCredits?: unknown; higgsfieldPlan?: unknown } | null
  if (!body || typeof body.higgsfieldCredits !== 'number' || !Number.isFinite(body.higgsfieldCredits)) {
    return apiError('higgsfieldCredits (number) is required', 400)
  }
  const plan = typeof body.higgsfieldPlan === 'string' ? body.higgsfieldPlan : undefined
  const credits = await setCanvasHiggsfieldBalance(orgId, body.higgsfieldCredits, plan)
  return apiSuccess({ credits })
})
