import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { createTemplate, listTemplates } from '@/lib/communications/store'
import { validateMessageTemplate } from '@/lib/communications/templates'
import { COMMUNICATION_CHANNELS, type CommunicationChannel } from '@/lib/communications/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const requestedChannel = searchParams.get('channel')
  const channel = isRouteCommunicationChannel(requestedChannel) ? requestedChannel : null
  return apiSuccess(await listTemplates(scope.orgId, channel))
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (!isRouteCommunicationChannel(body.channel)) return apiError('channel is required', 400)
  if (!body.content || typeof body.content !== 'object' || typeof body.content.body !== 'string') {
    return apiError('content.body is required', 400)
  }

  const draft = {
    id: 'new',
    orgId: scope.orgId,
    name: typeof body.name === 'string' ? body.name : '',
    channel: body.channel,
    status: body.status ?? 'draft',
    category: body.category,
    content: body.content,
    variables: Array.isArray(body.variables) ? body.variables : [],
    provider: body.provider ?? { id: body.channel === 'email' ? 'resend' : 'twilio' },
    createdAt: null,
    updatedAt: null,
  }
  const validation = validateMessageTemplate(draft)
  if (!validation.pass) return apiError('Template is invalid', 400, { validation })
  const result = await createTemplate(scope.orgId, draft)
  return apiSuccess(result, 201)
})

function isRouteCommunicationChannel(value: unknown): value is CommunicationChannel {
  return typeof value === 'string' && COMMUNICATION_CHANNELS.includes(value as CommunicationChannel)
}
