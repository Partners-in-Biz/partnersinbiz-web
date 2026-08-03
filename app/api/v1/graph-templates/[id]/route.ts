/**
 * GET   /api/v1/graph-templates/[id]
 * PATCH /api/v1/graph-templates/[id]
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  createOrUpdateGraphTemplate,
  getGraphTemplate,
} from '@/lib/workflow-graph'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const template = await getGraphTemplate(id)
  if (!template) return apiError('Graph template not found', 404)
  if (user.role !== 'ai' && !canAccessOrg(user, template.orgId)) return apiError('Forbidden', 403)

  const url = new URL(req.url)
  const scoped = cleanString(url.searchParams.get('orgId')) || cleanString(req.headers.get('x-org-id'))
  if (scoped && scoped !== template.orgId) return apiError('Forbidden', 403)
  return apiSuccess(template)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const existing = await getGraphTemplate(id)
  if (!existing) return apiError('Graph template not found', 404)
  if (user.role !== 'ai' && !canAccessOrg(user, existing.orgId)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const merged = {
    ...existing,
    ...body,
    id,
    orgId: existing.orgId,
    version: typeof body.version === 'number' ? body.version : (existing.version || 1) + (body.nodes ? 1 : 0),
  }
  const result = await createOrUpdateGraphTemplate(merged, user.uid, existing.orgId)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess(result.template)
})
