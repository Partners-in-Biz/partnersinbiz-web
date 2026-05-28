import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { searchContextReferences } from '@/lib/context-references/registry'
import { contextReferenceTypeFrom } from '@/lib/context-references/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser) => {
    const { searchParams } = new URL(req.url)
    const orgId = searchParams.get('orgId')
    const orgScope = resolveOrgScope(user, orgId)
    if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)

    const type = contextReferenceTypeFrom(searchParams.get('type'))
    if (!type) return apiError('type is required', 400)

    const rawLimit = Number.parseInt(searchParams.get('limit') ?? '8', 10)
    const limit = Number.isFinite(rawLimit) ? rawLimit : 8
    const refs = await searchContextReferences({
      type,
      query: searchParams.get('q') ?? '',
      orgId: orgScope.orgId,
      projectId: searchParams.get('projectId') ?? undefined,
      limit,
      user,
    })

    return apiSuccess({ refs })
  },
)
