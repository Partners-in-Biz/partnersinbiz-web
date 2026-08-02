/**
 * GET  /api/v1/graph-templates
 * POST /api/v1/graph-templates
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  createOrUpdateGraphTemplate,
  ensurePilotTemplate,
  listGraphTemplates,
} from '@/lib/workflow-graph'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveOrgId(req: NextRequest, body?: Record<string, unknown>): string {
  const url = new URL(req.url)
  return cleanString(url.searchParams.get('orgId'))
    || cleanString(req.headers.get('x-org-id'))
    || cleanString(body?.orgId)
}

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req)
  if (!orgId) return apiError('orgId is required', 400)
  if (user.role !== 'ai' && !canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const url = new URL(req.url)
  const ensurePilot = url.searchParams.get('ensurePilot') === 'true'
  const projectId = cleanString(url.searchParams.get('projectId')) || undefined
  if (ensurePilot) {
    const pilot = await ensurePilotTemplate(orgId, projectId, user.uid)
    return apiSuccess({ items: [pilot], pilot })
  }

  const limit = Number(url.searchParams.get('limit') || '50')
  const items = await listGraphTemplates(orgId, Number.isFinite(limit) ? limit : 50)
  return apiSuccess({ items })
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const orgId = resolveOrgId(req, body)
  if (!orgId) return apiError('orgId is required', 400)
  if (user.role !== 'ai' && !canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const result = await createOrUpdateGraphTemplate(body, user.uid, orgId)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess(result.template, result.template.id ? 200 : 201)
})
