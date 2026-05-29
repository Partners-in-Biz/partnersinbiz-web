import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { createCampaign, listCampaigns } from '@/lib/communications/store'
import { COMMUNICATION_CHANNELS, type CommunicationChannel } from '@/lib/communications/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const requestedChannel = searchParams.get('channel')
  const channel = isRouteCommunicationChannel(requestedChannel) ? requestedChannel : null
  return apiSuccess(await listCampaigns(scope.orgId, channel))
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (!isRouteCommunicationChannel(body.channel)) return apiError('channel is required', 400)
  if (typeof body.name !== 'string' || !body.name.trim()) return apiError('name is required', 400)
  if (typeof body.templateId !== 'string' || !body.templateId.trim()) return apiError('templateId is required', 400)
  const result = await createCampaign(scope.orgId, {
    name: body.name,
    channel: body.channel,
    templateId: body.templateId,
    status: body.status ?? 'draft',
    audience: body.audience,
    variableMap: body.variableMap,
    replyRouting: body.replyRouting,
    scheduledFor: body.scheduledFor ?? null,
  })
  return apiSuccess(result, 201)
})

function isRouteCommunicationChannel(value: unknown): value is CommunicationChannel {
  return typeof value === 'string' && COMMUNICATION_CHANNELS.includes(value as CommunicationChannel)
}
