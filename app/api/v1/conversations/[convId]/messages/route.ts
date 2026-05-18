/**
 * POST /api/v1/conversations/[convId]/messages — add a message
 * GET  /api/v1/conversations/[convId]/messages — list messages
 *
 * Auth: participant in the conversation OR admin role
 *
 * Phase 2: dispatches a Hermes run and stores the runId on the pending
 * assistant message. Multi-agent conversations route through Pip as orchestrator.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  getConversation,
  createMessage,
  listMessages,
  touchConversation,
  messagesCollection,
} from '@/lib/conversations/conversations'
import { createHermesRun } from '@/lib/hermes/server'
import { getAgentDecryptedKey } from '@/lib/agents/team'
import type { HermesProfileLink } from '@/lib/hermes/types'
import type { ApiUser } from '@/lib/api/types'
import type { AgentTeamDoc } from '@/lib/agents/types'
import type { AgentId, Conversation } from '@/lib/conversations/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

function canAccess(user: ApiUser, participantUids: string[]): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  return participantUids.includes(user.uid)
}

async function buildOrgContext(orgId: string): Promise<string> {
  try {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgDoc.exists) return ''
    const org = orgDoc.data() as Record<string, unknown> | undefined
    if (!org) return ''
    const brand = (org.brandProfile ?? {}) as Record<string, unknown>
    const doWords = Array.isArray(brand.doWords) ? (brand.doWords as string[]).filter(Boolean).join(', ') : ''
    const dontWords = Array.isArray(brand.dontWords) ? (brand.dontWords as string[]).filter(Boolean).join(', ') : ''
    const lines = [
      '[Client context — you are working on behalf of a Partners-in-Biz client organisation]',
      `orgId: ${orgId}`,
      org.name ? `name: ${org.name}` : '',
      org.slug ? `slug: ${org.slug}` : '',
      org.industry ? `industry: ${org.industry}` : '',
      org.website ? `website: ${org.website}` : '',
      org.description ? `description: ${org.description}` : '',
      brand.tagline ? `tagline: ${brand.tagline}` : '',
      brand.toneOfVoice ? `voice: ${brand.toneOfVoice}` : '',
      brand.targetAudience ? `audience: ${brand.targetAudience}` : '',
      doWords ? `do-words: ${doWords}` : '',
      dontWords ? `dont-words: ${dontWords}` : '',
      "When writing copy, taking actions, or making decisions on this client's behalf: stay in their voice, scope every platform API call to this orgId, and never leak data or copy from other clients. If a skill needs an orgId, this is the one to pass.",
      '---',
    ].filter(Boolean)
    return lines.join('\n') + '\n\n'
  } catch {
    return ''
  }
}

function buildConversationContext(conversation: Conversation, callerDisplayName: string): string {
  const participants = conversation.participants
    .map((p) =>
      p.kind === 'user'
        ? `${p.displayName ?? p.uid} (${p.role})`
        : `${p.name} (agent)`,
    )
    .join(', ')
  return `[Conversation — convId: ${conversation.id}, participants: ${participants}, initiated by: ${callerDisplayName}]\n\n`
}

function buildOrchestrationContext(conversation: Conversation, dispatchAgentId: AgentId): string {
  const requestedAgentIds =
    conversation.orchestration?.requestedAgentIds?.length
      ? conversation.orchestration.requestedAgentIds
      : conversation.participantAgentIds

  if (requestedAgentIds.length <= 1 || dispatchAgentId !== 'pip') return ''

  const agentNames = conversation.participants
    .filter((p): p is Extract<Conversation['participants'][number], { kind: 'agent' }> => p.kind === 'agent')
    .filter((p) => requestedAgentIds.includes(p.agentId))
    .map((p) => `${p.name} (${p.agentId})`)
    .join(', ')

  return [
    '[Multi-agent orchestration]',
    'You are Pip, the operator/orchestrator for this conversation.',
    `The admin selected these agents for the work: ${agentNames || requestedAgentIds.join(', ')}.`,
    'Do not make every selected agent answer separately by default.',
    'First decide whether this is simple enough to answer directly.',
    'For substantial or cross-domain work, create or describe clear task-bus work for the relevant specialists and synthesize the outcome for the user.',
    'Use the selected agents as routing intent: Theo=engineering, Maya=marketing/creative, Sage=research, Nora=operations/finance/admin.',
    'When you hand work off, keep the chat response concise and include what each specialist should own plus any board/session links you create.',
    '---',
    '',
  ].join('\n')
}

async function resolveDispatchAgentId(conversation: Conversation): Promise<AgentId | null> {
  if (conversation.participantAgentIds.length === 0) return null
  if (conversation.participantAgentIds.length === 1) return conversation.participantAgentIds[0]

  const orchestrator = conversation.orchestration?.dispatcherAgentId ?? 'pip'
  const orchestratorSnap = await adminDb.collection('agent_team').doc(orchestrator).get()
  const orchestratorData = orchestratorSnap.data()
  if (orchestratorSnap.exists && orchestratorData?.enabled) return orchestrator

  return conversation.participantAgentIds[0]
}

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canAccess(user, conversation.participantUids)) {
      return apiError('Forbidden', 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!content) return apiError('content is required and must be a non-empty string', 400)

    // Resolve author display name from Firestore
    let authorDisplayName = user.uid
    const userDoc = await adminDb.collection('users').doc(user.uid).get()
    if (userDoc.exists) {
      const userData = userDoc.data() ?? {}
      authorDisplayName =
        (userData.displayName as string | undefined) ||
        (userData.email as string | undefined) ||
        user.uid
    }

    // Store the user message
    const message = await createMessage(convId, {
      conversationId: convId,
      role: 'user',
      content,
      authorKind: 'user',
      authorId: user.uid,
      authorDisplayName,
      status: 'completed',
    })

    // Update the conversation's denorm fields
    await touchConversation(convId, content, 'user')

    // Phase 2: dispatch a Hermes run. Multi-agent conversations route via Pip.
    const dispatchAgentId = await resolveDispatchAgentId(conversation)
    if (dispatchAgentId) {
      const agentId = dispatchAgentId

      // Read agent doc from Firestore
      const agentSnap = await adminDb.collection('agent_team').doc(agentId).get()
      if (!agentSnap.exists) {
        return apiSuccess({ message }, 201)
      }
      const agentData = agentSnap.data() as AgentTeamDoc

      // Decrypt API key
      const decryptedKey = await getAgentDecryptedKey(agentId)

      // Build a HermesProfileLink from agent_team data
      const agentLink: HermesProfileLink = {
        orgId: conversation.orgId,
        profile: agentId,
        baseUrl: agentData.baseUrl,
        ...(decryptedKey ? { apiKey: decryptedKey } : {}),
        enabled: agentData.enabled,
        capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
        permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
      }

      // Build context string (org + conversation participants)
      const orgContext = await buildOrgContext(conversation.orgId)
      const convContext = buildConversationContext(conversation, authorDisplayName)
      const orchestrationContext = buildOrchestrationContext(conversation, agentId)
      const hermesInput = orgContext + convContext + orchestrationContext + content

      // Create pending assistant message first
      const assistantMessage = await createMessage(convId, {
        conversationId: convId,
        role: 'assistant',
        content: '',
        authorKind: 'agent',
        authorId: agentId,
        authorDisplayName: agentData.name,
        dispatchAgentId: agentId,
        status: 'pending',
      })

      // Dispatch Hermes run
      const runResult = await createHermesRun(agentLink, user.uid, {
        prompt: hermesInput,
        conversation_id: convId,
        metadata: {
          conversationId: convId,
          messageId: assistantMessage.id,
          orgId: conversation.orgId,
          dispatchAgentId: agentId,
          requestedAgentIds: conversation.orchestration?.requestedAgentIds ?? conversation.participantAgentIds,
          orchestrationMode: conversation.orchestration?.mode ?? (conversation.participantAgentIds.length > 1 ? 'pip-orchestrator' : 'direct'),
          source: 'pib-unified-chat',
        },
      })

      // Store runId on the pending message if run started
      if (runResult.response.ok) {
        const payload =
          runResult.data && typeof runResult.data === 'object'
            ? (runResult.data as Record<string, unknown>)
            : {}
        const runId = String(payload.run_id ?? payload.runId ?? payload.id ?? '')
        if (runId) {
          await messagesCollection(convId).doc(assistantMessage.id).update({
            runId,
            dispatchAgentId: agentId,
            ...(runResult.runDocId ? { runDocId: runResult.runDocId } : {}),
          })
        } else {
          await messagesCollection(convId).doc(assistantMessage.id).update({
            content: '',
            status: 'failed',
            error: 'Agent gateway did not return a run id',
          })
        }
        return apiSuccess(
          {
            message,
            assistantMessage: runId
              ? { ...assistantMessage, runId, dispatchAgentId: agentId }
              : { ...assistantMessage, status: 'failed', error: 'Agent gateway did not return a run id' },
            runId,
            dispatchAgentId: agentId,
            runDocId: runResult.runDocId,
          },
          201,
        )
      }

      await messagesCollection(convId).doc(assistantMessage.id).update({
        content: '',
        status: 'failed',
        error: 'Agent run could not be started on the gateway',
      })

      return apiSuccess({
        message,
        assistantMessage: {
          ...assistantMessage,
          status: 'failed',
          error: 'Agent run could not be started on the gateway',
        },
      }, 201)
    }

    return apiSuccess({ message }, 201)
  },
)

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canAccess(user, conversation.participantUids)) {
      return apiError('Forbidden', 403)
    }

    const messages = await listMessages(convId, 200)
    return apiSuccess({ messages })
  },
)
