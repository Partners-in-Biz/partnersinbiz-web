/**
 * Conversation-scoped subagent delegation (spawn / list / complete).
 * Chat-native branch surface for @agent handoffs and parent-agent fan-out.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getConversation, createMessage, touchConversation } from '@/lib/conversations/conversations'
import {
  authorizeConversationProject,
  canAccessConversation,
  canReplyConversation,
  publicConversationMessageView,
} from '@/lib/conversations/access'
import {
  buildAgentDelegationBranchPart,
  buildChildSummaryParentMessage,
  buildChatDelegationGoals,
  buildDelegationBranchSystemMessage,
  extractAgentMentionsForDelegation,
} from '@/lib/conversations/agent-delegation'
import { hermesFeaturesService } from '@/lib/hermes-features/service'
import type { Mention } from '@/lib/comments/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ convId: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

async function loadAccessibleConversation(convId: string, orgId: string, user: ApiUser) {
  const conversation = await getConversation(convId)
  if (!conversation) return { error: apiError('Conversation not found', 404) as Response }
  if (conversation.orgId !== orgId || !canAccessConversation(user, conversation)) {
    return { error: apiError('Forbidden', 403) as Response }
  }
  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) {
    return { error: apiError(projectAuthorization.error, projectAuthorization.status) as Response }
  }
  return { conversation }
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  const loaded = await loadAccessibleConversation(convId, orgId, user)
  if ('error' in loaded && loaded.error) return loaded.error

  const url = new URL(req.url)
  const id = url.searchParams.get('id')?.trim()
  if (id) {
    const delegation = await hermesFeaturesService.observeDelegation(orgId, id)
    if (!delegation || (delegation.conversationId && delegation.conversationId !== convId)) {
      return apiError('Delegation not found', 404)
    }
    return apiSuccess({
      delegation,
      branch: buildAgentDelegationBranchPart(delegation),
    })
  }

  const delegations = await hermesFeaturesService.repository.listDelegations(orgId, convId)
  return apiSuccess({
    delegations,
    branches: delegations.map(buildAgentDelegationBranchPart),
  })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  const loaded = await loadAccessibleConversation(convId, orgId, user)
  if ('error' in loaded && loaded.error) return loaded.error
  const conversation = loaded.conversation!

  if (!canReplyConversation(user, conversation)) {
    return apiError('Forbidden', 403)
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action.trim() : 'spawn'

  if (action === 'complete') {
    const delegationId = typeof body.delegationId === 'string' ? body.delegationId.trim() : ''
    const childId = typeof body.childId === 'string' ? body.childId.trim() : ''
    const result = typeof body.result === 'string' ? body.result : ''
    const ok = body.ok !== false
    if (!delegationId || !childId) return apiError('delegationId and childId are required', 400)

    const updated = await hermesFeaturesService.completeDelegationChild(
      orgId,
      delegationId,
      childId,
      result,
      ok,
    )
    if (updated.conversationId && updated.conversationId !== convId) {
      return apiError('Delegation not found', 404)
    }

    const summaryInput = buildChildSummaryParentMessage({
      conversationId: convId,
      record: updated,
      childId,
    })
    let summaryMessage = null
    if (summaryInput) {
      const created = await createMessage(convId, summaryInput)
      await touchConversation(convId, created.content.slice(0, 200), created.role, created.id)
      summaryMessage = publicConversationMessageView(created)
    }

    return apiSuccess({
      delegation: updated,
      branch: buildAgentDelegationBranchPart(updated),
      summaryMessage,
    })
  }

  // action === 'spawn'
  const parentAgentId = typeof body.parentAgentId === 'string' && body.parentAgentId.trim()
    ? body.parentAgentId.trim()
    : 'pip'
  const parentRunHint = typeof body.parentRunHint === 'string' && body.parentRunHint.trim()
    ? body.parentRunHint.trim()
    : `messages:${convId}`
  const messageContent = typeof body.messageContent === 'string' ? body.messageContent : ''
  const parentMessageId = typeof body.parentMessageId === 'string' ? body.parentMessageId : undefined
  const extraContext = typeof body.extraContext === 'string' ? body.extraContext : undefined
  const maxConcurrent = typeof body.maxConcurrent === 'number' ? body.maxConcurrent : undefined

  let agentIds: string[] = []
  if (Array.isArray(body.agentIds)) {
    agentIds = body.agentIds.map(String).map((id) => id.trim()).filter(Boolean)
  } else if (Array.isArray(body.mentions)) {
    const mentions = body.mentions as Mention[]
    agentIds = extractAgentMentionsForDelegation(mentions, {
      excludeAgentIds: [parentAgentId],
    })
  } else if (typeof body.agentId === 'string' && body.agentId.trim()) {
    agentIds = [body.agentId.trim()]
  }

  if (agentIds.length === 0) {
    return apiError('At least one agentId or @agent mention is required to spawn a branch', 400)
  }

  const goals = buildChatDelegationGoals({
    agentIds,
    messageContent,
    parentAgentId,
    parentMessageId,
    conversationId: convId,
    actorDisplayName: user.uid,
    extraContext,
  })

  const record = await hermesFeaturesService.spawnObservableDelegations({
    orgId,
    agentId: parentAgentId,
    conversationId: convId,
    parentRunHint,
    goals,
    maxConcurrent,
  })

  const systemMsg = buildDelegationBranchSystemMessage({
    conversationId: convId,
    record,
  })
  const branchMessage = await createMessage(convId, systemMsg)
  await touchConversation(convId, branchMessage.content.slice(0, 200), 'system', branchMessage.id)

  return apiSuccess({
    delegation: record,
    branch: buildAgentDelegationBranchPart(record),
    branchMessage: publicConversationMessageView(branchMessage),
  }, 201)
})
