import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getTwilioCall, listTwilioCalls } from '@/lib/twilio/calls'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)

  const callId = searchParams.get('callId')?.trim()
  if (callId) {
    const call = await getTwilioCall(scope.orgId, callId)
    if (!call) return apiError('Call not found', 404)
    return apiSuccess({ call })
  }

  const contactId = searchParams.get('contactId')?.trim() || null
  const limit = Number(searchParams.get('limit') || '50')
  const calls = await listTwilioCalls(scope.orgId, { contactId, limit })
  return apiSuccess({ calls })
})
