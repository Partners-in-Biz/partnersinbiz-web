import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  createBusinessRelationship,
  listBusinessRelationships,
  updateBusinessRelationship,
} from '@/lib/business-relationships/store'

export const dynamic = 'force-dynamic'

function paramsFromUrl(url: string) {
  const searchParams = new URL(url).searchParams
  return {
    companyId: searchParams.get('companyId') ?? undefined,
    targetOrgId: searchParams.get('targetOrgId') ?? undefined,
    status: searchParams.get('status') as never,
    capability: searchParams.get('capability') as never,
    limit: Number(searchParams.get('limit') ?? 100),
  }
}

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const relationships = await listBusinessRelationships(ctx.orgId, paramsFromUrl(req.url))
  return apiSuccess({ relationships })
})

export const POST = withCrmAuth('admin', async (req, ctx) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const relationship = await createBusinessRelationship(ctx.orgId, body as Record<string, unknown>, ctx.actor)
  return apiSuccess({ relationship }, 201)
})

export const PATCH = withCrmAuth('admin', async (req, ctx) => {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return apiError('id is required', 400)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const relationship = await updateBusinessRelationship(ctx.orgId, id, body as Record<string, unknown>, ctx.actor)
  return apiSuccess({ relationship })
})
