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
import { getStorage } from 'firebase-admin/storage'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import {
  buildDelegationAuthPromptBlock,
  mintMessagesDispatchDelegation,
} from '@/lib/api/delegations'
import { buildMailboxContextPromptBlock, listMailboxAccountsForUser } from '@/lib/mailbox/mailboxContext'
import { buildDynamicChatCanvasPromptBlock } from '@/lib/messages/dynamicChatCanvasPrompt'
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
import type { AuthorizedLinkedComputerDispatch } from '@/lib/linked-computers/runtime-targets'
import { parseLinkedRuntimeVersion } from '@/lib/linked-computers/runtime-targets'
import { cancelLinkedRun, enqueueLinkedRun, waitForLinkedRunClaim } from '@/lib/linked-computers/run-queue-store'
import { getAgentDispatchHermesProfileLink } from '@/lib/agents/team'
import { authorizeWorkspaceRuntime, type AuthorizedWorkspaceRuntime } from '@/lib/workspaces/runtime-authorization'
import {
  projectRuntimeReplicaApiError,
  requireProjectRuntimeReplica,
} from '@/lib/project-locations/runtime-binding'
import type { ProjectLocationReplica } from '@/lib/project-locations/model'
import { safeRuntimeTargetId, type RuntimeTargetSelectionErrorCode } from '@/lib/agents/runtime-targets'
import { cleanAgentEffort, VALID_AGENT_EFFORTS, type AgentEffort } from '@/lib/agents/runRouting'
import { cleanApprovalMode, shouldAutoApproveDangerousCommands } from '@/lib/messages/approval-mode'
import { memberCanUseAgentOnRuntime } from '@/lib/orgMembers/access-policy'
import { loadOrgMemberAccessPolicy } from '@/lib/orgMembers/org-access-policy'
import { buildAttachedContextBlock, resolveContextReferences } from '@/lib/context-references/registry'
import { buildProjectCodeWorkspacePrompt } from '@/lib/projects/code-workspace'
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
import { requireReadyLlmCredentialBinding } from '@/lib/llm-providers/bindings'
import { resolveLlmCredentialRuntimeTarget } from '@/lib/llm-providers/sync-targets'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import { resolveAuthorizedWorkingDirectory } from '@/lib/client-provisioning/working-directory'
import {
  enrichCompanyCoworkWorkspaceContext,
  conversationUsesCompanyCoworkFolder,
  linkedCoworkWorkingDirectory,
  linkedRuntimeSupportsCoworkWorkingDirectory,
} from '@/lib/client-provisioning/company-cowork-dispatch'
import { ensureCompanyCoworkFolderOnVps } from '@/lib/client-provisioning/ensure-company-cowork'
import { classifyWorkspaceDispatchFailure } from '@/lib/workspaces/dispatch-errors'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeConversationProject,
  canAccessConversation,
  canReplyConversation,
  publicConversationMessageView,
} from '@/lib/conversations/access'
import { resolveConversationDispatchAgentId } from '@/lib/conversations/dispatch-agent'
import type { AgentTeamDoc } from '@/lib/agents/types'
import type { AgentId, Conversation, ConversationAttachment, ConversationMessage } from '@/lib/conversations/types'
import { selectActiveProjectId } from '@/lib/projects/chatProgress'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }
type ResolvedConversationAttachment = ConversationAttachment & { storagePath?: string }
const LINKED_RUNTIME_IMAGE_INPUT_MIN_VERSION = [1, 1, 4] as const

function linkedRuntimeSupportsImageInput(version: string): boolean {
  const current = parseLinkedRuntimeVersion(version)
  if (!current) return false
  for (let index = 0; index < LINKED_RUNTIME_IMAGE_INPUT_MIN_VERSION.length; index++) {
    if (current[index] !== LINKED_RUNTIME_IMAGE_INPUT_MIN_VERSION[index]) {
      return current[index] > LINKED_RUNTIME_IMAGE_INPUT_MIN_VERSION[index]
    }
  }
  return true
}

async function linkedRunImages(attachments: ResolvedConversationAttachment[]): Promise<Array<{ url: string; contentType: string }>> {
  return Promise.all(attachments.flatMap((attachment) => (
    /^image\/(?:png|jpeg|gif|webp)$/i.test(attachment.contentType) && attachment.storagePath
      ? [{ attachment }]
      : []
  )).map(async ({ attachment }) => ({
    url: (await getStorage(getAdminApp()).bucket().file(attachment.storagePath!).getSignedUrl({
      action: 'read', expires: Date.now() + 30 * 60_000,
    }))[0],
    contentType: attachment.contentType,
  })))
}

async function resolveAttachments(value: unknown, convId: string, orgId: string): Promise<ResolvedConversationAttachment[] | null> {
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
    const storagePath = typeof attachment.storagePath === 'string' ? attachment.storagePath : ''
    if (!name || !contentType || sizeBytes < 0) return null
    return {
      id,
      name,
      url: `/api/v1/conversations/${convId}/attachments/${id}`,
      contentType,
      sizeBytes,
      ...(storagePath ? { storagePath } : {}),
    }
  }))
  return resolved.every((attachment): attachment is ResolvedConversationAttachment => attachment !== null)
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

async function buildOrgContext(
  orgId: string,
  workspace?: Conversation['workspaceContext'] | null,
): Promise<string> {
  const companyCowork = conversationUsesCompanyCoworkFolder(workspace)
  if (orgId === PIB_PLATFORM_ORG_ID) {
    if (companyCowork) {
      const companyLabel = workspace?.companyName?.trim() || 'this company'
      return [
        `[Platform security context — active organisation is Partners in Biz, but this chat is bound to the ${companyLabel} Cowork folder]`,
        `orgId: ${PIB_PLATFORM_ORG_ID}`,
        'Partners in Biz is only the security and operating perspective for permissions and agent dispatch.',
        `Do not treat this as a Partners in Biz platform session. Prior work, memory, wiki, and files must come from the ${companyLabel} Cowork folder and its agentDomain — not from Partners in Biz or other client folders.`,
        '---',
        '',
      ].join('\n')
    }
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

function buildConversationContext(
  conversation: Conversation,
  caller: { displayName: string; email?: string; uid: string },
): string {
  const participants = conversation.participants
    .map((p) =>
      p.kind === 'user'
        ? `${p.displayName ?? p.uid} (${p.role})`
        : `${p.name} (agent)`,
    )
    .join(', ')
  const lines = [
    '[Conversation — human identity (authoritative for this turn)]',
    `convId: ${conversation.id}`,
    `participants: ${participants}`,
    `initiated by: ${caller.displayName}`,
    `you_are_speaking_with_name: ${caller.displayName}`,
    caller.email ? `you_are_speaking_with_email: ${caller.email}` : '',
    `you_are_speaking_with_uid: ${caller.uid}`,
    'Address this human by their name above. Do not assume they are Peet Stander unless their name is Peet Stander.',
    'Peet Stander is the Partners in Biz founder; he is not automatically the person in this chat.',
    'Each Messages turn is bound to the authenticated human who sent the message. Never mix up members, never use another member\'s name or mailbox, and keep personal/private folders separate unless shareMode says otherwise.',
    '---',
    '',
  ].filter(Boolean)
  return `${lines.join('\n')}\n`
}

function buildWorkspaceContext(conversation: Conversation): string {
  const workspace = conversation.workspaceContext
  if (!workspace) return ''
  const companyCowork = workspace.folderScope === 'company'
    || (workspace.folderScope === 'project' && Boolean(workspace.companyWorkspaceId || workspace.companyId))
  const projectSession = workspace.folderScope === 'project' && Boolean(workspace.projectId)
  const bindingLine = companyCowork && !projectSession
    ? `[Workspace context — this chat is bound to the ${workspace.companyName || 'company'} Cowork folder]`
    : projectSession
      ? `[Workspace context — this chat is bound to PiB Project${workspace.projectName ? ` “${workspace.projectName}”` : ''}${workspace.companyName ? ` for ${workspace.companyName}` : ''}]`
      : '[Workspace context — this chat is bound to a Partners in Biz Workspace]'

  const codeMap = projectSession
    ? buildProjectCodeWorkspacePrompt({
      projectName: workspace.projectName,
      projectId: workspace.projectId,
      folderRelativePath: workspace.folderRelativePath,
      projectFolderMode: workspace.projectFolderMode,
      companyName: workspace.companyName,
      companyId: workspace.companyId,
      codeRoots: workspace.codeRoots,
      sharedFolder: workspace.sharedFolder,
    })
    : ''

  return [
    bindingLine,
    `workspaceId: ${workspace.workspaceId}`,
    `workspaceName: ${workspace.orgName}`,
    workspace.companyWorkspaceId ? `companyWorkspaceId: ${workspace.companyWorkspaceId}` : '',
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
    workspace.projectFolderMode ? `projectFolderMode: ${workspace.projectFolderMode}` : '',
    workspace.sharedFolder ? 'sharedFolder: true' : '',
    workspace.vpsWorkingPath ? `vpsWorkingPath: ${workspace.vpsWorkingPath}` : '',
    workspace.localWorkingPath ? `localWorkingPath: ${workspace.localWorkingPath}` : '',
    `agentDomain: ${workspace.agentDomain}`,
    `agentDomainPath: ${workspace.agentDomainPath}`,
    `localAgentDomainPath: ${workspace.localAgentDomainPath}`,
    workspace.companyId ? `crmCompanyId: ${workspace.companyId}` : '',
    workspace.companyName ? `crmCompanyName: ${workspace.companyName}` : '',
    workspace.contactIds.length ? `crmContactIds: ${workspace.contactIds.join(', ')}` : '',
    `shareMode: ${workspace.shareMode}`,
    `ownerUserId: ${workspace.ownerUserId}`,
    'The active orgId is the security and operating perspective for this session. crmCompanyId identifies the CRM company folder; a linked organisation mentioned in AGENTS.md is metadata and a delivery relationship, not permission to browse or act inside that organisation.',
    companyCowork && !projectSession
      ? 'This is a company Cowork session. Treat the runtime-matching company working path above as the session working directory. Read that company root AGENTS.md/CLAUDE.md and the company agentDomain hot.md/index.md before answering about prior work. Do not use Partners in Biz platform history unless the user explicitly asks about Partners in Biz.'
      : projectSession
        ? 'This is a project delivery session. Treat the runtime-matching project working path as cwd. Read project AGENTS.md, company parent AGENTS.md when nested under Cowork/partners/{Company}, and the agentDomain wiki before inventing company or product facts. Multiple Projects may share this disk path — do not duplicate repositories.'
        : 'Treat the runtime-matching working path above as this chat session’s working directory. Keep project artefacts inside it, and read the company root AGENTS.md/CLAUDE.md plus .pib-workspace.json before acting when file access is available.',
    'Keep user chat threads separate unless the shareMode or user request says otherwise.',
    '---',
    '',
    codeMap,
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

function buildStudioArtifactOrchestrationContext(input: { dispatchAgentId: AgentId; conversationId: string; requestMessageId: string; responseMessageId: string }): string {
  if (input.dispatchAgentId !== 'pip') return ''
  return [
    '[Studio artifact orchestration]',
    `For every artifact created from this turn, send conversationOrigin exactly as {"conversationId":"${input.conversationId}","requestMessageId":"${input.requestMessageId}","responseMessageId":"${input.responseMessageId}","bundleId":"${input.responseMessageId}","sequence":0}; increment sequence for each additional artifact in the same bundle.`,
    'clear, bounded, low-risk, reversible draft → immediate create;',
    'ambiguous, multi-artifact, materially paid, sensitive, approval-gated, rights-sensitive, or publish-intended work → structured preview first;',
    'confirmation resumes the same Hermes run via existing UI actions;',
    'preserve existing model/provider routing policy;',
    'publish/store submission/external sharing never bypasses approval.',
    'Return created artifacts as studio_artifact or studio_artifact_bundle rich parts containing stable identities only: artifacts:[{"id":"<exact artifact id>","contextId":"<authoritative parent Studio context id>"}]. For a parent artifact, id and contextId are the same. Never include snapshots, titles, statuses, previews, URLs, or other mutable fields.',
    '---',
    '',
  ].join('\n')
}

function buildProjectChatOrchestrationContext(input: {
  conversation: Conversation
  dispatchAgentId: AgentId
  requestMessageId: string
  responseMessageId: string
}): string {
  if (input.dispatchAgentId !== 'pip') return ''
  const projectId = selectActiveProjectId(input.conversation)
  if (!projectId) return ''
  const bundleId = `${input.conversation.id}:${input.responseMessageId}`
  return [
    '[Project chat orchestration]',
    'You are Pip, the project front door. Projects/Kanban remains the source of truth.',
    `projectId: ${projectId}`,
    `conversationId: ${input.conversation.id}`,
    `requestMessageId: ${input.requestMessageId}`,
    `responseMessageId: ${input.responseMessageId}`,
    `bundleId: ${bundleId}`,
    'Create a clear, bounded, low-risk single task immediately when the request is unambiguous.',
    'For ambiguous work, more than one task, sensitive capabilities, or approval-gated work, preview the chain and wait for confirmation before creating tasks.',
    'Every created project task must include chatOrigin with the IDs above plus a zero-based sequence. Preserve assigneeAgentId, agentModel, agentEffort, dependsOn, reviewerAgentId, riskLevel, requiredCapability, approvalGateTaskId, and expectedArtifacts as applicable.',
    'For a preview, return a structured rich part with type "project_task_proposal", projectId, bundleId, and tasks. Each task must include title, assigneeAgentId, dependencySequence, reviewerAgentId, requiredCapability, agentEffort, and modelPolicy. Include one custom UI action labelled "Create tasks" so confirmation resumes this run.',
    'Do not manually dispatch dependent tasks from chat. The existing watcher releases and dispatches them when their dependencies and approval gates clear.',
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
    const projectAuthorization = await authorizeConversationProject(user, conversation)
    if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)
    const boundProjectId = projectAuthorization.projectId ?? undefined

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
    const rawApprovalMode = (body as Record<string, unknown>).approvalMode
    const approvalMode = cleanApprovalMode(rawApprovalMode) ?? 'ask'
    if (rawApprovalMode !== undefined && rawApprovalMode !== null && rawApprovalMode !== '' && !cleanApprovalMode(rawApprovalMode)) {
      return apiError('Invalid approvalMode; expected ask | smart | full', 400)
    }
    const yolo = shouldAutoApproveDangerousCommands(approvalMode)
    const requestedModel = (body as Record<string, unknown>).model
    const requestedProvider = (body as Record<string, unknown>).provider
    const requestedConnectionId = (body as Record<string, unknown>).llmConnectionId
    const requestedCredentialBindingId = (body as Record<string, unknown>).llmCredentialBindingId
    const hasModelSelection = requestedModel !== undefined
      || requestedProvider !== undefined
      || requestedConnectionId !== undefined
      || requestedCredentialBindingId !== undefined
    const attachments = await resolveAttachments((body as Record<string, unknown>).attachments, convId, conversation.orgId)
    if (!attachments) return apiError('One or more attachments are invalid for this conversation', 400)
    const publicAttachments: ConversationAttachment[] = attachments.map(({ storagePath: _storagePath, ...attachment }) => attachment)
    const slashCommand = sanitizeSlashCommand((body as Record<string, unknown>).slashCommand)
    if (!content && attachments.length === 0) return apiError('content or attachments are required', 400)
    const resolvedContextRefs = await resolveContextReferences(
      mergeContextReferenceSeeds(
        sanitizeContextReferenceSeeds(conversation.contextRefs ?? []),
        sanitizeContextReferenceSeeds((body as Record<string, unknown>).contextRefs),
      ),
      user,
      conversation.orgId,
      { conversationId: convId },
    )

    // Resolve author identity from Firestore (authoritative for agent greetings / isolation)
    let authorDisplayName = user.uid
    let authorEmail: string | undefined
    const userDoc = await adminDb.collection('users').doc(user.uid).get()
    if (userDoc.exists) {
      const userData = userDoc.data() ?? {}
      authorDisplayName =
        (userData.displayName as string | undefined) ||
        (userData.email as string | undefined) ||
        user.uid
      authorEmail = typeof userData.email === 'string' ? userData.email : undefined
    }

    // Resolve dispatch target before storing the message so unauthorized or
    // invalid model/provider overrides fail without creating a partial thread.
    const dispatchAgentId = await resolveConversationDispatchAgentId(conversation)
    let modelSelection: {
      model: string
      provider?: string
      llmConnectionId: string
      llmCredentialBindingId: string
    } | undefined
    if (dispatchAgentId && hasModelSelection) {
      const modelValidation = await validateMessageModelSelection({
        conversation,
        user,
        agentId: dispatchAgentId,
        model: requestedModel,
        provider: requestedProvider,
        connectionId: requestedConnectionId,
        credentialBindingId: requestedCredentialBindingId,
      })
      if (!modelValidation.ok) {
        return apiError(modelValidation.error ?? 'Invalid model selection', modelValidation.status ?? 400)
      }
      modelSelection = modelValidation.selection
      if (modelSelection) {
        try {
          const credentialTarget = await resolveLlmCredentialRuntimeTarget({
            runtimeTargetId: conversation.workspaceContext?.runtimeTarget,
            orgId: conversation.orgId,
            ownerUid: user.uid,
            agentId: dispatchAgentId,
          })
          await requireReadyLlmCredentialBinding({
            bindingId: modelSelection.llmCredentialBindingId,
            connectionId: modelSelection.llmConnectionId,
            orgId: conversation.orgId,
            ownerUid: user.uid,
            runtimeTargetId: credentialTarget.runtimeTargetId,
            agentId: dispatchAgentId,
          })
        } catch (error) {
          return apiError(error instanceof Error ? error.message : 'Selected LLM account is not ready', 409)
        }
      }
    }

    // A session remains bound to its selected computer. Re-authorize that
    // binding before persisting the user's message so an offline, revoked, or
    // cross-tenant target cannot leave a misleading partial exchange behind.
    const requestedRuntimeTarget = conversation.workspaceContext?.runtimeTarget?.trim() || null
    let authorizedWorkspaceRuntime: AuthorizedWorkspaceRuntime | null = null
    if (requestedRuntimeTarget && conversation.workspaceContext?.workspaceId && dispatchAgentId) {
      const scopedAccessPolicy = (await loadOrgMemberAccessPolicy(conversation.orgId, user.uid))
        ?? user.memberAccessPolicy
        ?? null
      // Platform admins and Pip are always allowed. Everyone else needs a Team
      // grant, ownership of a personal linked agent, or org-manager rights on a
      // shared organisation agent.
      if (user.role !== 'admin' && dispatchAgentId !== 'pip') {
        const granted = memberCanUseAgentOnRuntime(
          scopedAccessPolicy,
          requestedRuntimeTarget,
          dispatchAgentId,
        )
        if (!granted) {
          const agentSnap = await adminDb.collection('agent_team').doc(dispatchAgentId).get()
          const agentData = agentSnap.exists
            ? agentSnap.data() as {
                accessScope?: string
                ownerUserId?: string
                provisioningMode?: string
                scopeOrgId?: string
              }
            : null
          const ownsPersonalLinkedAgent = agentData?.provisioningMode === 'linked_device'
            && agentData.accessScope === 'personal'
            && agentData.ownerUserId === user.uid
          let managesOrgLinkedAgent = false
          if (
            agentData?.provisioningMode === 'linked_device'
            && agentData.accessScope === 'organization'
            && agentData.scopeOrgId === conversation.orgId
          ) {
            const membership = await adminDb.collection('orgMembers').doc(`${conversation.orgId}_${user.uid}`).get()
            const memberRole = membership.data()?.role
            managesOrgLinkedAgent = memberRole === 'owner' || memberRole === 'admin'
          }
          if (!ownsPersonalLinkedAgent && !managesOrgLinkedAgent) {
            return apiError('This member is not allowed to use that agent on the selected computer', 403)
          }
        }
      }
      try {
        authorizedWorkspaceRuntime = await authorizeWorkspaceRuntime({
          userId: user.uid,
          orgId: conversation.orgId,
          workspaceId: conversation.workspaceContext.workspaceId,
          runtimeTargetId: requestedRuntimeTarget,
          ...(conversation.workspaceContext.mappingId
            ? { mappingId: conversation.workspaceContext.mappingId }
            : {}),
          agentId: dispatchAgentId,
        })
      } catch {
        return apiError('Computer unavailable', 409)
      }
    }

    let boundProjectReplica: ProjectLocationReplica | null = null
    if (authorizedWorkspaceRuntime && conversation.workspaceContext?.workspaceId && boundProjectId) {
      try {
        boundProjectReplica = await requireProjectRuntimeReplica({
          projectId: boundProjectId,
          orgId: conversation.orgId,
          workspaceId: conversation.workspaceContext.workspaceId,
          actorUserId: user.uid,
          runtime: authorizedWorkspaceRuntime,
        })
      } catch (error) {
        const mapped = projectRuntimeReplicaApiError(error)
        return apiError(mapped.message, mapped.status)
      }
    }

    // Store the user message
    const message = await createMessage(convId, {
      conversationId: convId,
      role: 'user',
      content,
      ...(publicAttachments.length > 0 ? { attachments: publicAttachments } : {}),
      ...(resolvedContextRefs.length > 0 ? { contextRefs: resolvedContextRefs } : {}),
      ...(slashCommand ? { slashCommand } : {}),
      ...(agentEffort ? { agentEffort } : {}),
      ...(modelSelection?.model ? { model: modelSelection.model } : {}),
      ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
      ...(modelSelection?.llmConnectionId ? { llmConnectionId: modelSelection.llmConnectionId } : {}),
      ...(modelSelection?.llmCredentialBindingId ? { llmCredentialBindingId: modelSelection.llmCredentialBindingId } : {}),
      authorKind: 'user',
      authorId: user.uid,
      authorDisplayName,
      status: 'completed',
    })

    // Update the conversation's denorm fields
    const preview = content || publicAttachments.map((attachment) => attachment.name).join(', ')
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
        approvalMode,
        ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
        ...(modelSelection?.llmConnectionId ? { llmConnectionId: modelSelection.llmConnectionId } : {}),
        ...(modelSelection?.llmCredentialBindingId ? { llmCredentialBindingId: modelSelection.llmCredentialBindingId } : {}),
        status: 'pending',
      })

      let agentLink: Awaited<ReturnType<typeof getAgentDispatchHermesProfileLink>> | null = null
      let linkedComputerBinding: AuthorizedLinkedComputerDispatch | null =
        authorizedWorkspaceRuntime?.kind === 'linked-computer' ? authorizedWorkspaceRuntime : null
      try {
        if (requestedRuntimeTarget && conversation.workspaceContext?.mappingId
          && linkedComputerBinding?.mappingId !== conversation.workspaceContext.mappingId) {
          // Mapping-specific sessions must not fall through to compatibility /
          // execution-location auth that ignores the chosen Workspace folder.
          const { authorizeLinkedComputerDispatch } = await import('@/lib/linked-computers/runtime-targets')
          linkedComputerBinding = await authorizeLinkedComputerDispatch({
            userId: user.uid,
            orgId: conversation.orgId,
            workspaceId: conversation.workspaceContext.workspaceId,
            runtimeTargetId: requestedRuntimeTarget,
            mappingId: conversation.workspaceContext.mappingId,
            agentId,
          })
        } else if (requestedRuntimeTarget && !authorizedWorkspaceRuntime) {
          if (!conversation.workspaceContext) throw new Error('Computer dispatch requires a Workspace')
          const authorizedRuntime = await authorizeWorkspaceRuntime({
            userId: user.uid,
            orgId: conversation.orgId,
            workspaceId: conversation.workspaceContext.workspaceId,
            runtimeTargetId: requestedRuntimeTarget,
            ...(conversation.workspaceContext.mappingId
              ? { mappingId: conversation.workspaceContext.mappingId }
              : {}),
            agentId,
          })
          if (authorizedRuntime.kind === 'linked-computer') linkedComputerBinding = authorizedRuntime
        }
        if (!linkedComputerBinding) {
          agentLink = await getAgentDispatchHermesProfileLink(agentId, conversation.orgId, { runtimeTarget: requestedRuntimeTarget })
          if (!agentLink) throw new Error(`No reachable runtime target configured for agent_team/${agentId}`)
          if (authorizedWorkspaceRuntime?.kind === 'execution-location'
            && (agentLink.runtimeTargetId !== authorizedWorkspaceRuntime.runtimeTargetId
              || !agentLink.transportIdentity
              || !authorizedWorkspaceRuntime.transportIdentity
              || agentLink.transportIdentity !== authorizedWorkspaceRuntime.transportIdentity)) {
            throw Object.assign(new Error('Authorized runtime transport changed before dispatch'), {
              code: 'runtime_target_binding_mismatch',
              requestedTargetId: requestedRuntimeTarget,
            })
          }
        }
      } catch (err) {
        const runtimeFailure = err && typeof err === 'object'
          ? err as { code?: unknown; requestedTargetId?: unknown; message?: unknown }
          : null
        const allowedFailureCodes: RuntimeTargetSelectionErrorCode[] = [
          'runtime_target_invalid_id', 'runtime_target_not_found', 'runtime_target_disabled',
          'runtime_target_stale', 'runtime_target_unhealthy', 'runtime_target_missing_api_key',
          'runtime_target_binding_mismatch',
        ]
        const runtimeDispatchFailureCode = typeof runtimeFailure?.code === 'string'
          && allowedFailureCodes.includes(runtimeFailure.code as RuntimeTargetSelectionErrorCode)
          ? runtimeFailure.code as RuntimeTargetSelectionErrorCode
          : undefined
        const requestedRuntimeTargetId = safeRuntimeTargetId(runtimeFailure?.requestedTargetId)
          ?? safeRuntimeTargetId(conversation.workspaceContext?.runtimeTarget)
          ?? (runtimeDispatchFailureCode === 'runtime_target_invalid_id' ? 'invalid' : undefined)
        const error = runtimeDispatchFailureCode === 'runtime_target_binding_mismatch'
          ? 'The selected computer changed before the agent could start. Pick Partners VPS again and retry.'
          : runtimeDispatchFailureCode === 'runtime_target_stale'
            ? 'That computer went offline. Pick a healthy computer and retry.'
            : runtimeDispatchFailureCode === 'runtime_target_unhealthy'
              ? 'That computer is unhealthy right now. Pick another computer or retry shortly.'
              : runtimeDispatchFailureCode === 'runtime_target_missing_api_key'
                ? 'Agent dispatch credentials are missing for that computer.'
                : runtimeDispatchFailureCode === 'runtime_target_disabled'
                  || runtimeDispatchFailureCode === 'runtime_target_not_found'
                  || runtimeDispatchFailureCode === 'runtime_target_invalid_id'
                  ? 'That computer is not available for agent dispatch.'
                  : process.env.VERCEL_ENV === 'preview'
                    ? 'Agent dispatch is not configured for this Preview environment.'
                    : 'Agent dispatch could not reach the selected computer. Retry or pick another runtime.'
        console.error('[conversation-agent-dispatch-failed]', {
          convId,
          agentId,
          code: runtimeDispatchFailureCode ?? 'agent_dispatch_unavailable',
          ...(requestedRuntimeTargetId ? { requestedRuntimeTargetId } : {}),
        })
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
      if (conversation.workspaceContext) {
        conversation.workspaceContext = await enrichCompanyCoworkWorkspaceContext(conversation.workspaceContext)
        if (conversationUsesCompanyCoworkFolder(conversation.workspaceContext)) {
          const ensured = await ensureCompanyCoworkFolderOnVps(conversation.workspaceContext)
          if (!ensured.ok) {
            const error = ensured.error
            await messagesCollection(convId).doc(assistantMessage.id).update({
              content: '',
              status: 'failed',
              error,
              workspaceDispatchFailureCode: ensured.code === 'company_workspace_missing'
                ? 'workspace_context_invalid'
                : 'workspace_directory_missing',
            })
            return apiSuccess({
              message,
              assistantMessage: {
                ...assistantMessage,
                status: 'failed',
                error,
                workspaceDispatchFailureCode: ensured.code === 'company_workspace_missing'
                  ? 'workspace_context_invalid'
                  : 'workspace_directory_missing',
              },
            }, 201)
          }
          conversation.workspaceContext = ensured.workspace
        }
      }
      const orgContext = await buildOrgContext(conversation.orgId, conversation.workspaceContext)
      const convContext = buildConversationContext(conversation, {
        displayName: authorDisplayName,
        uid: user.uid,
        ...(authorEmail ? { email: authorEmail } : {}),
      })
      const workspaceContext = buildWorkspaceContext(conversation)
      const orchestrationContext = buildOrchestrationContext(conversation, agentId)
      const projectChatOrchestrationContext = buildProjectChatOrchestrationContext({
        conversation,
        dispatchAgentId: agentId,
        requestMessageId: message.id,
        responseMessageId: assistantMessage.id,
      })
      const studioArtifactOrchestrationContext = buildStudioArtifactOrchestrationContext({
        dispatchAgentId: agentId,
        conversationId: convId,
        requestMessageId: message.id,
        responseMessageId: assistantMessage.id,
      })
      const agentSkillsContext = buildAgentSkillsPromptBlock(agentData, agentId)
      const decisionDataRuleContext = buildDecisionDataOperatingRuleContext()
      const attachedContext = buildAttachedContextBlock(resolvedContextRefs)
      const commandContext = slashCommand ? slashCommandInstruction(slashCommand) : ''
      const attachmentContext = publicAttachments.length > 0
        ? `\n\n[Attachments]\n${publicAttachments.map((attachment) => `- ${attachment.name}: ${attachment.url} (${attachment.contentType}, ${attachment.sizeBytes} bytes)`).join('\n')}`
        : ''
      const mintedDelegation = await mintMessagesDispatchDelegation({
        user,
        orgId: conversation.orgId,
        agentId,
        conversationId: convId,
      })
      const mailboxAccounts = await listMailboxAccountsForUser(conversation.orgId, user.uid).catch(() => [])
      const dynamicChatCanvasContext = buildDynamicChatCanvasPromptBlock({
        conversationId: convId,
        responseMessageId: assistantMessage.id,
      })
      const mailboxContext = buildMailboxContextPromptBlock({
        orgId: conversation.orgId,
        uid: user.uid,
        accounts: mailboxAccounts,
        mailboxDelegationEvidenceId: mintedDelegation?.mailboxDelegationEvidenceId,
        conversationId: convId,
        responseMessageId: assistantMessage.id,
      })
      const delegationAuthContext = mintedDelegation
        ? buildDelegationAuthPromptBlock({
          token: mintedDelegation.token,
          expiresAt: mintedDelegation.expiresAt,
          orgId: conversation.orgId,
          agentId,
          actingForUserId: mintedDelegation.actingForUserId,
          scopes: mintedDelegation.scopes,
          mailboxDelegationEvidenceId: mintedDelegation.mailboxDelegationEvidenceId,
        })
        : ''
      const hermesInput = orgContext + convContext + workspaceContext + orchestrationContext + projectChatOrchestrationContext + studioArtifactOrchestrationContext + agentSkillsContext + decisionDataRuleContext + dynamicChatCanvasContext + mailboxContext + delegationAuthContext + attachedContext + conversationHistory + commandContext + content + attachmentContext
      if (linkedComputerBinding) {
        const hasImageAttachments = attachments.some((attachment) => (
          /^image\/(?:png|jpeg|gif|webp)$/i.test(attachment.contentType) && Boolean(attachment.storagePath)
        ))
        if (hasImageAttachments && !linkedRuntimeSupportsImageInput(linkedComputerBinding.runtimeVersion)) {
          const error = 'This computer needs Linked Runtime 1.1.4+ before chat image attachments can be analysed.'
          await messagesCollection(convId).doc(assistantMessage.id).update({
            content: '', status: 'failed', error, workspaceDispatchFailureCode: 'linked_device_update_required',
          })
          return apiSuccess({ message, assistantMessage: { ...assistantMessage, status: 'failed', error, workspaceDispatchFailureCode: 'linked_device_update_required' } }, 201)
        }
        const images = await linkedRunImages(attachments)
        const projectId = boundProjectId
        const preferVps = linkedComputerBinding.platform === 'linux'
        const coworkWorkingDirectory = linkedCoworkWorkingDirectory(conversation.workspaceContext, { preferVps })
        if (coworkWorkingDirectory
          && !linkedRuntimeSupportsCoworkWorkingDirectory(linkedComputerBinding.runtimeVersion)) {
          const error = 'This computer needs a Linked Runtime update (1.1.3+) before company Cowork folders can run on it.'
          await messagesCollection(convId).doc(assistantMessage.id).update({
            content: '',
            status: 'failed',
            error,
            workspaceDispatchFailureCode: 'linked_device_update_required',
          })
          return apiSuccess({
            message,
            assistantMessage: {
              ...assistantMessage,
              status: 'failed',
              error,
              workspaceDispatchFailureCode: 'linked_device_update_required',
            },
          }, 201)
        }
        const queued = await enqueueLinkedRun({
          requestId: assistantMessage.id,
          deviceId: linkedComputerBinding.deviceId,
          runtimeTargetId: linkedComputerBinding.runtimeTargetId,
          orgId: conversation.orgId,
          actorUserId: user.uid,
          workspaceId: linkedComputerBinding.workspaceId,
          ...(projectId && boundProjectReplica ? { projectId, projectReplicaId: boundProjectReplica.replicaId } : {}),
          mappingId: boundProjectReplica?.mappingId || linkedComputerBinding.mappingId,
          relativeFolder: boundProjectReplica?.relativePath ?? (projectId ? `projects/${projectId}` : '.'),
          ...(coworkWorkingDirectory ? { workingDirectory: coworkWorkingDirectory } : {}),
          credentialVersion: linkedComputerBinding.credentialVersion,
          payload: {
            prompt: hermesInput,
            ...(images.length ? { images } : {}),
            ...(modelSelection?.model ? { model: modelSelection.model } : {}),
            ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
            ...(yolo ? { yolo: true } : {}),
          },
          conversationId: convId,
          assistantMessageId: assistantMessage.id,
          agentId,
        })
        try {
          const claimed = await waitForLinkedRunClaim(queued)
          const verifiedAcceptance = claimed.acceptanceReceipt
          if (!verifiedAcceptance) throw new Error('linked computers: signed acceptance required')
          const acceptedDevice = {
            deviceId: verifiedAcceptance.deviceId,
            runtimeTargetId: linkedComputerBinding.runtimeTargetId,
            machineLabel: verifiedAcceptance.machineLabel,
            runtimeVersion: verifiedAcceptance.runtimeVersion,
            acceptedAt: verifiedAcceptance.acceptedAt,
            outcome: 'accepted',
          }
          await messagesCollection(convId).doc(assistantMessage.id).update({
            runId: queued.jobId, dispatchAgentId: agentId, acceptedDevice,
            linkedDeviceId: linkedComputerBinding.deviceId,
            linkedDeviceMappingId: boundProjectReplica?.mappingId || linkedComputerBinding.mappingId,
            linkedDeviceCredentialVersion: linkedComputerBinding.credentialVersion,
            ...(mintedDelegation ? { delegationId: mintedDelegation.id } : {}),
          })
          return apiSuccess({ message, assistantMessage: { ...assistantMessage, runId: queued.jobId, dispatchAgentId: agentId, acceptedDevice }, runId: queued.jobId, dispatchAgentId: agentId }, 201)
        } catch {
          const cancelled = await cancelLinkedRun(queued.jobId, 'claim timeout')
          if (!cancelled.won) {
            return apiSuccess({ message, assistantMessage: { ...assistantMessage, runId: queued.jobId, dispatchAgentId: agentId, status: cancelled.status }, runId: queued.jobId, dispatchAgentId: agentId }, 201)
          }
          const error = 'The linked computer did not accept the run in time. It may be restarting, offline, or busy — confirm the selected computer is online and retry in a few seconds.'
          await messagesCollection(convId).doc(assistantMessage.id).update({ content: '', status: 'failed', error, workspaceDispatchFailureCode: 'linked_device_claim_timeout' })
          return apiSuccess({ message, assistantMessage: { ...assistantMessage, status: 'failed', error, workspaceDispatchFailureCode: 'linked_device_claim_timeout' } }, 201)
        }
      }
      let selectedWorkingDirectory: string | undefined
      let selectedWorkingDirectoryRoot: string | undefined
      let workspacePathClass: 'organisation' | 'company' | 'project' | undefined
      if (conversation.workspaceContext && !linkedComputerBinding) {
        const workingDirectory = await resolveAuthorizedWorkingDirectory({
          workspaceContext: conversation.workspaceContext,
          ...(boundProjectReplica ? {
            projectId: boundProjectId,
            projectRelativePath: boundProjectReplica.relativePath,
          } : {}),
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
        selectedWorkingDirectoryRoot = conversation.workspaceContext.runtimeTarget === 'local'
          ? conversation.workspaceContext.localPath
          : conversation.workspaceContext.vpsPath
        workspacePathClass = workingDirectory.pathClass
      }

      // Dispatch Hermes run
      const dispatchLink = agentLink
      if (!dispatchLink) throw new Error(`No reachable runtime target configured for agent_team/${agentId}`)
      const runResult = await createHermesRun(dispatchLink, user.uid, {
        prompt: hermesInput,
        conversation_id: convId,
        ...(selectedWorkingDirectory ? { working_directory: selectedWorkingDirectory } : {}),
        ...(selectedWorkingDirectoryRoot ? { working_directory_root: selectedWorkingDirectoryRoot } : {}),
        ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
        ...(agentEffort ? { reasoning_effort: agentEffort } : {}),
        ...(yolo ? { yolo: true } : {}),
        dispatch: {
          requestedRuntimeTargetId: conversation.workspaceContext?.runtimeTarget ?? dispatchLink.runtimeTargetId,
        },
        metadata: {
          conversationId: convId,
          messageId: assistantMessage.id,
          orgId: conversation.orgId,
          ...(conversation.workspaceContext?.workspaceId ? { workspaceId: conversation.workspaceContext.workspaceId } : {}),
          ...(conversation.workspaceContext?.runtimeTarget ? { runtimeTarget: conversation.workspaceContext.runtimeTarget } : {}),
          ...(conversation.workspaceContext?.runtimeTarget ? { requestedRuntimeTargetId: conversation.workspaceContext.runtimeTarget } : {}),
          ...(dispatchLink.runtimeTargetId ? { runtimeTargetId: dispatchLink.runtimeTargetId } : {}),
          ...(dispatchLink.runtimeKind ? { runtimeKind: dispatchLink.runtimeKind } : {}),
          ...(dispatchLink.machineLabel ? { runtimeMachineLabel: dispatchLink.machineLabel } : {}),
          ...(workspacePathClass ? { workspacePathClass } : {}),
          ...(conversation.workspaceContext?.projectId ? { projectId: conversation.workspaceContext.projectId } : {}),
          dispatchAgentId: agentId,
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
          ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
          requestedAgentIds: conversation.orchestration?.requestedAgentIds ?? conversation.participantAgentIds,
          orchestrationMode: conversation.orchestration?.mode ?? (conversation.participantAgentIds.length > 1 ? 'pip-orchestrator' : 'direct'),
          source: 'pib-unified-chat',
          approvalMode,
          ...(agentEffort ? { agentEffort } : {}),
          ...(resolvedContextRefs.length > 0 ? { contextRefs: resolvedContextRefs } : {}),
          ...(slashCommand ? { slashCommand } : {}),
          ...(mintedDelegation ? {
            delegationId: mintedDelegation.id,
            authKind: 'user_delegation',
            actingForUserId: mintedDelegation.actingForUserId,
          } : {}),
        },
      }).catch(async (err) => {
        const safeFailure = classifyWorkspaceDispatchFailure(err)
        console.error('[conversation-agent-dispatch-failed]', {
          convId,
          agentId,
          code: safeFailure.code,
        })
        await messagesCollection(convId).doc(assistantMessage.id).update({
          content: '',
          status: 'failed',
          error: safeFailure.message,
          workspaceDispatchFailureCode: safeFailure.code,
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
      if (runResult.ok) {
        const payload =
          runResult.data && typeof runResult.data === 'object'
            ? (runResult.data as Record<string, unknown>)
            : {}
        const runId = String(payload.run_id ?? payload.runId ?? payload.id ?? '')
        if (runId) {
          await messagesCollection(convId).doc(assistantMessage.id).update({
            runId,
            dispatchAgentId: agentId,
            ...(dispatchLink.runtimeTargetId ? { dispatchRuntimeTargetId: dispatchLink.runtimeTargetId } : {}),
            ...(dispatchLink.runtimeKind ? { dispatchRuntimeKind: dispatchLink.runtimeKind } : {}),
            ...(dispatchLink.machineLabel ? { dispatchRuntimeLabel: dispatchLink.machineLabel } : {}),
            ...(runResult.runDocId ? { runDocId: runResult.runDocId } : {}),
            ...(mintedDelegation ? { delegationId: mintedDelegation.id } : {}),
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
              ? {
                  ...assistantMessage,
                  runId,
                  dispatchAgentId: agentId,
                  ...(dispatchLink.runtimeTargetId ? { dispatchRuntimeTargetId: dispatchLink.runtimeTargetId } : {}),
                  ...(dispatchLink.runtimeKind ? { dispatchRuntimeKind: dispatchLink.runtimeKind } : {}),
                  ...(dispatchLink.machineLabel ? { dispatchRuntimeLabel: dispatchLink.machineLabel } : {}),
                }
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

    const projectAuthorization = await authorizeConversationProject(user, conversation)
    if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

    const messages = await listMessages(convId, 200)
    return apiSuccess({ messages: messages.map(publicConversationMessageView) })
  },
)
