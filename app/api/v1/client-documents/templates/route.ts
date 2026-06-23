import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { createUserTemplateFromDocument, listUserTemplates } from '@/lib/client-documents/userTemplates'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const requestedOrgId = searchParams.get('orgId')

  let orgId: string | undefined
  if (requestedOrgId) {
    const scope = resolveOrgScope(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    orgId = scope.orgId
  }

  const templates = await listUserTemplates({ user, orgId })
  return apiSuccess(templates)
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return apiError('name is required', 400)

  const documentId = typeof body.documentId === 'string' ? body.documentId.trim() : ''
  if (!documentId) return apiError('documentId is required', 400)

  if (body.description !== undefined && typeof body.description !== 'string') {
    return apiError('description must be a string', 400)
  }

  let orgId: string | undefined
  if (typeof body.orgId === 'string' && body.orgId.trim()) {
    const scope = resolveOrgScope(user, body.orgId.trim())
    if (!scope.ok) return apiError(scope.error, scope.status)
    orgId = scope.orgId
  }

  const result = await createUserTemplateFromDocument({
    name,
    description: typeof body.description === 'string' ? body.description : undefined,
    orgId,
    documentId,
    user,
  })

  if (!result.ok) return apiError(result.error, result.status)

  return apiSuccess({ id: result.id }, 201)
})
