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
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import {
  getConversation,
  createMessage,
  listMessages,
  touchConversation,
  messagesCollection,
} from '@/lib/conversations/conversations'
import { createHermesRun } from '@/lib/hermes/server'
import { getAgentDecryptedKey } from '@/lib/agents/team'
import { cleanAgentEffort, VALID_AGENT_EFFORTS, type AgentEffort } from '@/lib/agents/runRouting'
import { buildAttachedContextBlock, resolveContextReferences } from '@/lib/context-references/registry'
import {
  contextReferenceKey,
  MAX_CONTEXT_REFS,
  sanitizeContextReferenceSeeds,
  type ContextReferenceSeed,
} from '@/lib/context-references/types'
import { councilModeGuidanceLines, getSlashCommandByToken, slashCommandInstruction, type SlashCommandPayload } from '@/lib/chat/slash-commands'
import { buildAgentSkillsPromptBlock } from '@/lib/chat/agent-skills'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import type { HermesProfileLink } from '@/lib/hermes/types'
import type { ApiUser } from '@/lib/api/types'
import type { AgentTeamDoc } from '@/lib/agents/types'
import type { AgentId, Conversation, ConversationAttachment, ConversationMessage } from '@/lib/conversations/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

function canAccess(user: ApiUser, participantUids: string[]): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  return participantUids.includes(user.uid)
}

function sanitizeAttachments(value: unknown): ConversationAttachment[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 5).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    const contentType = typeof raw.contentType === 'string'
      ? raw.contentType.trim().toLowerCase()
      : typeof raw.mimeType === 'string'
        ? raw.mimeType.trim().toLowerCase()
        : ''
    const sizeBytes = typeof raw.sizeBytes === 'number'
      ? raw.sizeBytes
      : typeof raw.size === 'number'
        ? raw.size
        : 0
    const storagePath = typeof raw.storagePath === 'string' ? raw.storagePath.trim() : ''

    if (!id || !name || !url || !contentType || !Number.isFinite(sizeBytes) || sizeBytes < 0) return []
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return []
    } catch {
      return []
    }

    return [{
      id,
      name,
      url,
      contentType,
      sizeBytes,
      ...(storagePath ? { storagePath } : {}),
    }]
  })
}

function sanitizeSlashCommand(value: unknown): SlashCommandPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const token = typeof raw.token === 'string' ? raw.token.trim().toLowerCase() : ''
  const definition = getSlashCommandByToken(token)
  if (!definition) return null
  const args = typeof raw.args === 'string' ? raw.args.slice(0, 4000).trim() : ''
  return {
    id: definition.id,
    token: definition.token,
    label: definition.label,
    executorKind: definition.executorKind,
    args,
  }
}

function parseReasoningDirective(value: string): { content: string; agentEffort: AgentEffort | null } {
  const match = value.match(/^\s*\/reasoning\s+([a-z]+)\b\s*/i)
  if (!match) return { content: value, agentEffort: null }
  const effort = cleanAgentEffort(match[1])
  if (!effort) return { content: value, agentEffort: null }
  return { content: value.slice(match[0].length).trim(), agentEffort: effort }
}

function mergeContextReferenceSeeds(...groups: ContextReferenceSeed[][]): ContextReferenceSeed[] {
  const byKey = new Map<string, ContextReferenceSeed>()
  for (const group of groups) {
    for (const ref of group) byKey.set(contextReferenceKey(ref), ref)
  }
  return Array.from(byKey.values()).slice(0, MAX_CONTEXT_REFS)
}

async function buildOrgContext(orgId: string): Promise<string> {
  if (orgId === PIB_PLATFORM_ORG_ID) {
    return [
      '[Platform context - you are working in the top-level Partners in Biz workspace]',
      `orgId: ${PIB_PLATFORM_ORG_ID}`,
      'name: Partners in Biz',
      'This is not a client organisation. Treat it like the parent workspace above all client folders: internal operations, planning, cross-client coordination, and platform-level decisions belong here.',
      'When a task needs client data or client-scoped API calls, ask for or infer the client workspace before acting on that client.',
      '---',
      '',
    ].join('\n')
  }

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

function messageAuthorLabel(message: ConversationMessage): string {
  if (message.authorDisplayName?.trim()) return message.authorDisplayName.trim()
  if (message.authorId?.trim()) return message.authorId.trim()
  return message.role
}

function normalizeHistoryContent(message: ConversationMessage): string {
  const content = typeof message.content === 'string' ? message.content.trim() : ''
  if (content) return content.replace(/\s+$/g, '')
  if (message.error) return `[${message.status ?? 'failed'}: ${message.error}]`
  if (message.attachments?.length) return `[attachments: ${message.attachments.map((attachment) => attachment.name).join(', ')}]`
  return ''
}

function buildConversationHistoryBlock(messages: ConversationMessage[], currentMessageId: string): string {
  const priorMessages = messages
    .filter((message) => message.id !== currentMessageId)
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ message, content: normalizeHistoryContent(message) }))
    .filter(({ content }) => content.length > 0)
    .slice(-30)

  if (priorMessages.length === 0) return ''

  const lines = priorMessages.map(({ message, content }) => {
    const label = message.role === 'assistant'
      ? `${messageAuthorLabel(message)} (assistant)`
      : `${messageAuthorLabel(message)} (user)`
    const clipped = content.length > 2000 ? `${content.slice(0, 2000).trimEnd()}…` : content
    return `${label}: ${clipped}`
  })

  return [
    '[Recent conversation history — use this to preserve context and answer the latest user message as part of the ongoing thread]',
    ...lines,
    '---',
    '',
  ].join('\n')
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
    'Use the selected agents as routing intent and as the available council membership for this turn.',
    ...councilModeGuidanceLines('multi-agent-chat'),
    'Do not make every selected agent answer separately by default; use only the perspectives that add material value.',
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
    const replyAccess = await assertUserCanPerformOrganizationModuleAction(
      user,
      conversation.orgId,
      'messages',
      'reply',
      'Conversation replies are disabled for your organisation role',
    )
    if (!replyAccess.ok) return apiError(replyAccess.error, replyAccess.status)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

    const rawContent = typeof body.content === 'string' ? body.content.trim() : ''
    const reasoningDirective = parseReasoningDirective(rawContent)
    const content = reasoningDirective.content
    const rawEffort = (body as Record<string, unknown>).agentEffort
    const requestedEffort = cleanAgentEffort(rawEffort)
    if (rawEffort !== undefined && rawEffort !== null && rawEffort !== '' && !requestedEffort) {
      return apiError(`Invalid agentEffort; expected one of ${VALID_AGENT_EFFORTS.join(' | ')}`, 400)
    }
    const agentEffort = reasoningDirective.agentEffort ?? requestedEffort
    const attachments = sanitizeAttachments((body as Record<string, unknown>).attachments)
    const slashCommand = sanitizeSlashCommand((body as Record<string, unknown>).slashCommand)
    if (!content && attachments.length === 0) return apiError('content or attachments are required', 400)
    const resolvedContextRefs = await resolveContextReferences(
      mergeContextReferenceSeeds(
        sanitizeContextReferenceSeeds(conversation.contextRefs ?? []),
        sanitizeContextReferenceSeeds((body as Record<string, unknown>).contextRefs),
      ),
      user,
      conversation.orgId,
    )

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
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(resolvedContextRefs.length > 0 ? { contextRefs: resolvedContextRefs } : {}),
      ...(slashCommand ? { slashCommand } : {}),
      ...(agentEffort ? { agentEffort } : {}),
      authorKind: 'user',
      authorId: user.uid,
      authorDisplayName,
      status: 'completed',
    })

    // Update the conversation's denorm fields
    const preview = content || attachments.map((attachment) => attachment.name).join(', ')
    await touchConversation(convId, preview, 'user')

    const recentMessages = await listMessages(convId, 200).catch(() => [message])
    const conversationHistory = buildConversationHistoryBlock(recentMessages, message.id)

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

      // Create pending assistant message first so dispatch/config failures are
      // visible in the thread instead of surfacing as a raw 500 after the user
      // message has already been saved.
      const assistantMessage = await createMessage(convId, {
        conversationId: convId,
        role: 'assistant',
        content: '',
        authorKind: 'agent',
        authorId: agentId,
        authorDisplayName: agentData.name,
        dispatchAgentId: agentId,
        ...(agentEffort ? { agentEffort } : {}),
        status: 'pending',
      })

      let decryptedKey: string | null
      try {
        // Decrypt API key
        decryptedKey = await getAgentDecryptedKey(agentId)
      } catch (err) {
        console.error('[conversation-agent-dispatch-failed]', {
          convId,
          agentId,
          error: err instanceof Error ? err.message : String(err),
        })
        const error = 'Agent dispatch is not configured for this Preview environment.'
        await messagesCollection(convId).doc(assistantMessage.id).update({
          content: '',
          status: 'failed',
          error,
        })
        return apiSuccess({
          message,
          assistantMessage: { ...assistantMessage, status: 'failed', error },
        }, 201)
      }

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
      const agentSkillsContext = buildAgentSkillsPromptBlock(agentData, agentId)
      const attachedContext = buildAttachedContextBlock(resolvedContextRefs)
      const commandContext = slashCommand ? slashCommandInstruction(slashCommand) : ''
      const attachmentContext = attachments.length > 0
        ? `\n\n[Attachments]\n${attachments.map((attachment) => `- ${attachment.name}: ${attachment.url} (${attachment.contentType}, ${attachment.sizeBytes} bytes)`).join('\n')}`
        : ''
      const hermesInput = orgContext + convContext + orchestrationContext + agentSkillsContext + attachedContext + conversationHistory + commandContext + content + attachmentContext

      // Dispatch Hermes run
      const runResult = await createHermesRun(agentLink, user.uid, {
        prompt: hermesInput,
        conversation_id: convId,
        ...(agentEffort ? { reasoning_effort: agentEffort } : {}),
        metadata: {
          conversationId: convId,
          messageId: assistantMessage.id,
          orgId: conversation.orgId,
          dispatchAgentId: agentId,
          requestedAgentIds: conversation.orchestration?.requestedAgentIds ?? conversation.participantAgentIds,
          orchestrationMode: conversation.orchestration?.mode ?? (conversation.participantAgentIds.length > 1 ? 'pip-orchestrator' : 'direct'),
          source: 'pib-unified-chat',
          ...(agentEffort ? { agentEffort } : {}),
          ...(resolvedContextRefs.length > 0 ? { contextRefs: resolvedContextRefs } : {}),
          ...(slashCommand ? { slashCommand } : {}),
        },
      }).catch(async (err) => {
        console.error('[conversation-agent-dispatch-failed]', {
          convId,
          agentId,
          error: err instanceof Error ? err.message : String(err),
        })
        const error = 'Agent run could not be started on the gateway.'
        await messagesCollection(convId).doc(assistantMessage.id).update({
          content: '',
          status: 'failed',
          error,
        })
        return null
      })

      if (!runResult) {
        return apiSuccess({
          message,
          assistantMessage: {
            ...assistantMessage,
            status: 'failed',
            error: 'Agent run could not be started on the gateway.',
          },
        }, 201)
      }

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
