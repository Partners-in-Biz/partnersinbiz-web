import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  createServiceWorkspace,
  listServiceWorkspaces,
  updateServiceWorkspace,
} from '@/lib/service-workspaces/store'
import { guardAgentCrmAction } from '@/lib/agents/action-guard'

export const dynamic = 'force-dynamic'

function paramsFromUrl(url: string) {
  const searchParams = new URL(url).searchParams
  return {
    companyId: searchParams.get('companyId') ?? undefined,
    relationshipId: searchParams.get('relationshipId') ?? undefined,
    projectId: searchParams.get('projectId') ?? undefined,
    serviceType: searchParams.get('serviceType') as never,
    status: searchParams.get('status') as never,
    limit: Number(searchParams.get('limit') ?? 100),
  }
}

function actionForBody(body: Record<string, unknown>) {
  return body.visibility === 'client_visible' ? 'client_visible' : 'draft'
}

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const serviceWorkspaces = await listServiceWorkspaces(ctx.orgId, paramsFromUrl(req.url))
  return apiSuccess({ serviceWorkspaces })
})

export const POST = withCrmAuth('member', async (req, ctx) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const guard = guardAgentCrmAction(ctx, {
    action: actionForBody(body as Record<string, unknown>),
    visibility: typeof (body as Record<string, unknown>).visibility === 'string' ? (body as Record<string, unknown>).visibility as string : undefined,
    approvalState: typeof (body as Record<string, unknown>).approvalState === 'string' ? (body as Record<string, unknown>).approvalState as string : undefined,
  })
  if (!guard.allowed) return apiSuccess({ approvalRequired: true, reason: guard.reason }, 202)
  const serviceWorkspace = await createServiceWorkspace(ctx.orgId, body as Record<string, unknown>, ctx.actor)
  return apiSuccess({ serviceWorkspace }, 201)
})

export const PATCH = withCrmAuth('member', async (req, ctx) => {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return apiError('id is required', 400)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const guard = guardAgentCrmAction(ctx, {
    action: actionForBody(body as Record<string, unknown>),
    visibility: typeof (body as Record<string, unknown>).visibility === 'string' ? (body as Record<string, unknown>).visibility as string : undefined,
    approvalState: typeof (body as Record<string, unknown>).approvalState === 'string' ? (body as Record<string, unknown>).approvalState as string : undefined,
  })
  if (!guard.allowed) return apiSuccess({ approvalRequired: true, reason: guard.reason }, 202)
  const serviceWorkspace = await updateServiceWorkspace(ctx.orgId, id, body as Record<string, unknown>, ctx.actor)
  return apiSuccess({ serviceWorkspace })
})
