import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import {
  listChatContextCapabilities,
  summarizeChatContextCoverage,
} from '@/lib/chat-context/capabilities'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgScope = resolveOrgScope(user, new URL(req.url).searchParams.get('orgId'))
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)
  if (user.role === 'ai' && (!user.orgId || user.orgId !== orgScope.orgId)) {
    return apiError('AI credentials are not authorised for this organisation', 403)
  }

  const capabilities = listChatContextCapabilities()
  return apiSuccess({
    orgId: orgScope.orgId,
    coverage: summarizeChatContextCoverage(capabilities),
    capabilities,
  })
})
