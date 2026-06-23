import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleUserTemplate, softDeleteUserTemplate } from '@/lib/client-documents/userTemplates'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ templateId: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { templateId } = await ctx.params
  const result = await getAccessibleUserTemplate(templateId, user)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess(result.template)
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { templateId } = await ctx.params
  const result = await softDeleteUserTemplate(templateId, user)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ id: templateId, deleted: true })
})
