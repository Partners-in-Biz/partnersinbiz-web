import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { actorFrom } from '@/lib/api/actor'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  createConversation,
  listConversations,
  type ConversationFilters,
} from '@/lib/communications/store'
import { COMMUNICATION_CHANNELS, type CommunicationChannel, type ConversationPriority, type ConversationStatus } from '@/lib/communications/types'

export const dynamic = 'force-dynamic'

const STATUSES: ConversationStatus[] = ['new', 'open', 'pending', 'resolved', 'snoozed']
const PRIORITIES: ConversationPriority[] = ['low', 'normal', 'high', 'urgent']

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)

  const filters: ConversationFilters = {
    status: cleanStatus(searchParams.get('status')),
    channel: cleanChannel(searchParams.get('channel')),
    assignee: cleanOptional(searchParams.get('assignee')),
    campaignId: cleanOptional(searchParams.get('campaignId')),
    queueId: cleanOptional(searchParams.get('queueId')),
    priority: cleanPriority(searchParams.get('priority')),
    label: cleanOptional(searchParams.get('label')),
    limit: clampLimit(searchParams.get('limit')),
  }

  return apiSuccess(await listConversations(scope.orgId, filters))
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)

  const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  if (!isRouteCommunicationChannel(body.channel)) return apiError('channel is required', 400)

  const actor = actorFrom(user)
  const result = await createConversation(scope.orgId, {
    channel: body.channel,
    contactId: cleanOptional(body.contactId),
    body: typeof body.body === 'string' ? body.body : '',
    subject: typeof body.subject === 'string' ? body.subject : '',
    queueId: cleanOptional(body.queueId),
    campaignId: cleanOptional(body.campaignId),
    labels: Array.isArray(body.labels) ? body.labels : [],
    priority: PRIORITIES.includes(body.priority) ? body.priority : 'normal',
    ...actor,
  })

  return apiSuccess(result, 201)
})

function cleanOptional(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanStatus(value: unknown): ConversationStatus | null {
  return STATUSES.includes(value as ConversationStatus) ? value as ConversationStatus : null
}

function cleanPriority(value: unknown): ConversationPriority | null {
  return PRIORITIES.includes(value as ConversationPriority) ? value as ConversationPriority : null
}

function isRouteCommunicationChannel(value: unknown): value is CommunicationChannel {
  return typeof value === 'string' && COMMUNICATION_CHANNELS.includes(value as CommunicationChannel)
}

function cleanChannel(value: unknown) {
  return isRouteCommunicationChannel(value) ? value : null
}

function clampLimit(value: string | null): number {
  const parsed = Number(value ?? 100)
  if (!Number.isFinite(parsed)) return 100
  return Math.max(1, Math.min(500, Math.floor(parsed)))
}
