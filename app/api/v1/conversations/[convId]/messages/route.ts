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
import { getAgentDispatchHermesProfileLink } from '@/lib/agents/team'
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
import { CEO_APPROVAL_CARD_RULE_LINES, buildCeoDataDecisionOperatingRuleLines } from '@/lib/agent/ceo-operating-rule'
import { validateMessageModelSelection } from '@/lib/messages/model-catalog'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import { resolveAuthorizedWorkingDirectory } from '@/lib/client-provisioning/working-directory'
import type { ApiUser } from '@/lib/api/types'
import { canAccessConversation, canReplyConversation, publicConversationMessageView } from '@/lib/conversations/access'
import type { AgentTeamDoc } from '@/lib/agents/types'
import type { AgentId, Conversation, ConversationAttachment, ConversationMessage } from '@/lib/conversations/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

async function resolveAttachments(value: unknown, convId: string, orgId: string): Promise<ConversationAttachment[] | null> {
  if (!Array.isArray(value)) return []
  if (value.length > 5) return null
  const resolved = await Promise.all(value.map(async (item) => {
    if (!item || typeof item !== 'object') return null
    const raw = item as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!id) return null
    const attachmentDoc = await adminDb.collection('conversation_attachments').doc(id).get()
    if (!attachmentDoc.exists) return null
    const attachment = attachmentDoc.data() ?? {}
    if (attachment.conversationId !== convId || attachment.orgId !== orgId || attachment.deleted === true) return null
    const name = typeof attachment.name === 'string' ? attachment.name : ''
    const contentType = typeof attachment.contentType === 'string' ? attachment.contentType : ''
    const sizeBytes = typeof attachment.sizeBytes === 'number' ? attachment.sizeBytes : -1
    if (!name || !contentType || sizeBytes < 0) return null
    return {
      id,
      name,
      url: `/api/v1/conversations/${convId}/attachments/${id}`,
      contentType,
      sizeBytes,
    }
  }))
  return resolved.every((attachment): attachment is ConversationAttachment => attachment !== null)
    ? resolved
    : null
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

function buildWorkspaceContext(conversation: Conversation): string {
  const workspace = conversation.workspaceContext
  if (!workspace) return ''
  return [
    '[Workspace context — this chat is bound to a Partners in Biz Workspace]',
    `workspaceId: ${workspace.workspaceId}`,
    `workspaceName: ${workspace.orgName}`,
    `orgId: ${workspace.orgId}`,
    `orgSlug: ${workspace.orgSlug}`,
    `sourceOfTruth: ${workspace.sourceOfTruth}`,
    `runtimeTarget: ${workspace.runtimeTarget}`,
    `runtimeLabel: ${workspace.runtimeLabel}`,
    `vpsPath: ${workspace.vpsPath}`,
    `localPath: ${workspace.localPath}`,
    workspace.folderScope ? `folderScope: ${workspace.folderScope}` : '',
    workspace.folderRelativePath ? `folderRelativePath: ${workspace.folderRelativePath}` : '',
    workspace.projectId ? `projectId: ${workspace.projectId}` : '',
    workspace.projectName ? `projectName: ${workspace.projectName}` : '',
    workspace.vpsWorkingPath ? `vpsWorkingPath: ${workspace.vpsWorkingPath}` : '',
    workspace.localWorkingPath ? `localWorkingPath: ${workspace.localWorkingPath}` : '',
    `agentDomain: ${workspace.agentDomain}`,
    `agentDomainPath: ${workspace.agentDomainPath}`,
    `localAgentDomainPath: ${workspace.localAgentDomainPath}`,
    workspace.companyId ? `crmCompanyId: ${workspace.companyId}` : '',
    workspace.contactIds.length ? `crmContactIds: ${workspace.contactIds.join(', ')}` : '',
    `shareMode: ${workspace.shareMode}`,
    `ownerUserId: ${workspace.ownerUserId}`,
    'Treat the runtime-matching working path above as this chat session’s working directory. Create the project directory if it does not exist, keep project artefacts inside it, and read the Workspace root AGENTS.md/CLAUDE.md plus .pib-workspace.json before acting when file access is available.',
    'Keep user chat threads separate unless the shareMode or user request says otherwise.',
    '---',
    '',
  ].filter(Boolean).join('\n')
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

function buildDecisionDataOperatingRuleContext(): string {
  return [
    ...buildCeoDataDecisionOperatingRuleLines({ orgId: 'the current orgId' }),
    ...CEO_APPROVAL_CARD_RULE_LINES,
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

    if (!canAccessConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }
    if (!canReplyConversation(user, conversation)) {
      return apiError('Only explicit participants can reply to this conversation', 403)
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
    const requestedModel = (body as Record<string, unknown>).model
    const requestedProvider = (body as Record<string, unknown>).provider
    const hasModelSelection = requestedModel !== undefined || requestedProvider !== undefined
    const attachments = await resolveAttachments((body as Record<string, unknown>).attachments, convId, conversation.orgId)
    if (!attachments) return apiError('One or more attachments are invalid for this conversation', 400)
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

    // Resolve dispatch target before storing the message so unauthorized or
    // invalid model/provider overrides fail without creating a partial thread.
    const dispatchAgentId = await resolveDispatchAgentId(conversation)
    let modelSelection: { model: string; provider?: string } | undefined
    if (hasModelSelection) {
      const modelValidation = await validateMessageModelSelection({
        conversation,
        user,
        agentId: dispatchAgentId,
        model: requestedModel,
        provider: requestedProvider,
      })
      if (!modelValidation.ok) {
        return apiError(modelValidation.error ?? 'Invalid model selection', modelValidation.status ?? 400)
      }
      modelSelection = modelValidation.selection
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
      ...(modelSelection?.model ? { model: modelSelection.model } : {}),
      ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
      authorKind: 'user',
      authorId: user.uid,
      authorDisplayName,
      status: 'completed',
    })

    // Update the conversation's denorm fields
    const preview = content || attachments.map((attachment) => attachment.name).join(', ')
    await touchConversation(convId, preview, 'user', message.id)

    const recentMessages = await listMessages(convId, 200).catch(() => [message])
    const conversationHistory = buildConversationHistoryBlock(recentMessages, message.id)

    // Phase 2: dispatch a Hermes run. Multi-agent conversations route via Pip.
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
        ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
        status: 'pending',
      })

      let agentLink: Awaited<ReturnType<typeof getAgentDispatchHermesProfileLink>>
      try {
        agentLink = await getAgentDispatchHermesProfileLink(agentId, conversation.orgId, {
          runtimeTarget: conversation.workspaceContext?.runtimeTarget ?? null,
        })
        if (!agentLink) throw new Error(`No reachable runtime target configured for agent_team/${agentId}`)
      } catch (err) {
        console.error('[conversation-agent-dispatch-failed]', {
          convId,
          agentId,
          error: err instanceof Error ? err.message : String(err),
        })
        const error = 'Agent dispatch is not configured for this Preview environment.'
        const runtimeFailure = err && typeof err === 'object'
          ? err as { code?: unknown; requestedTargetId?: unknown }
          : null
        const runtimeDispatchFailureCode = typeof runtimeFailure?.code === 'string' ? runtimeFailure.code : undefined
        const requestedRuntimeTargetId = typeof runtimeFailure?.requestedTargetId === 'string'
          ? runtimeFailure.requestedTargetId
          : conversation.workspaceContext?.runtimeTarget
        await messagesCollection(convId).doc(assistantMessage.id).update({
          content: '',
          status: 'failed',
          error,
          ...(runtimeDispatchFailureCode ? { runtimeDispatchFailureCode } : {}),
          ...(requestedRuntimeTargetId ? { requestedRuntimeTargetId } : {}),
        })
        return apiSuccess({
          message,
          assistantMessage: { ...assistantMessage, status: 'failed', error },
        }, 201)
      }

      // Build context string (org + conversation participants)
      const orgContext = await buildOrgContext(conversation.orgId)
      const convContext = buildConversationContext(conversation, authorDisplayName)
      const workspaceContext = buildWorkspaceContext(conversation)
      const orchestrationContext = buildOrchestrationContext(conversation, agentId)
      const agentSkillsContext = buildAgentSkillsPromptBlock(agentData, agentId)
      const decisionDataRuleContext = buildDecisionDataOperatingRuleContext()
      const attachedContext = buildAttachedContextBlock(resolvedContextRefs)
      const commandContext = slashCommand ? slashCommandInstruction(slashCommand) : ''
      const attachmentContext = attachments.length > 0
        ? `\n\n[Attachments]\n${attachments.map((attachment) => `- ${attachment.name}: ${attachment.url} (${attachment.contentType}, ${attachment.sizeBytes} bytes)`).join('\n')}`
        : ''
      const hermesInput = orgContext + convContext + workspaceContext + orchestrationContext + agentSkillsContext + decisionDataRuleContext + attachedContext + conversationHistory + commandContext + content + attachmentContext
      let selectedWorkingDirectory: string | undefined
      if (conversation.workspaceContext) {
        const workingDirectory = await resolveAuthorizedWorkingDirectory({
          workspaceContext: conversation.workspaceContext,
        })
        if (!workingDirectory.ok) {
          const error = 'The selected workspace directory is unavailable or not authorized.'
          await messagesCollection(convId).doc(assistantMessage.id).update({
            content: '',
            status: 'failed',
            error,
            workspaceDispatchFailureCode: workingDirectory.code,
          })
          return apiSuccess({
            message,
            assistantMessage: {
              ...assistantMessage,
              status: 'failed',
              error,
              workspaceDispatchFailureCode: workingDirectory.code,
            },
          }, 201)
        }
        selectedWorkingDirectory = workingDirectory.directory
      }

      // Dispatch Hermes run
      const runResult = await createHermesRun(agentLink, user.uid, {
        prompt: hermesInput,
        conversation_id: convId,
        ...(selectedWorkingDirectory ? { working_directory: selectedWorkingDirectory } : {}),
        ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
        ...(agentEffort ? { reasoning_effort: agentEffort } : {}),
        metadata: {
          conversationId: convId,
          messageId: assistantMessage.id,
          orgId: conversation.orgId,
          ...(conversation.workspaceContext ? { workspaceContext: conversation.workspaceContext } : {}),
          ...(conversation.workspaceContext?.workspaceId ? { workspaceId: conversation.workspaceContext.workspaceId } : {}),
          ...(conversation.workspaceContext?.runtimeTarget ? { runtimeTarget: conversation.workspaceContext.runtimeTarget } : {}),
          ...(conversation.workspaceContext?.runtimeTarget ? { requestedRuntimeTargetId: conversation.workspaceContext.runtimeTarget } : {}),
          ...(agentLink.runtimeTargetId ? { runtimeTargetId: agentLink.runtimeTargetId } : {}),
          ...(agentLink.runtimeKind ? { runtimeKind: agentLink.runtimeKind } : {}),
          ...(agentLink.machineLabel ? { runtimeMachineLabel: agentLink.machineLabel } : {}),
          ...(conversation.workspaceContext?.vpsWorkingPath ? { vpsWorkingPath: conversation.workspaceContext.vpsWorkingPath } : {}),
          ...(conversation.workspaceContext?.localWorkingPath ? { localWorkingPath: conversation.workspaceContext.localWorkingPath } : {}),
          ...(conversation.workspaceContext?.projectId ? { projectId: conversation.workspaceContext.projectId } : {}),
          dispatchAgentId: agentId,
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
          ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
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

    if (!canAccessConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }

    const messages = await listMessages(convId, 200)
    return apiSuccess({ messages: messages.map(publicConversationMessageView) })
  },
)
