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
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'
import { buildDelegationAuthPromptBlock } from '@/lib/api/delegations'
import { mintFreshMessagesTurnDelegation } from '@/lib/messages/turn-delegation'
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
  patchConversation,
} from '@/lib/conversations/conversations'
import { createHermesRun } from '@/lib/hermes/server'
import {
  authorizeLinkedComputerRecoveryQueue,
  LinkedComputerDispatchError,
  parseLinkedRuntimeVersion,
  type AuthorizedLinkedComputerDispatch,
} from '@/lib/linked-computers/runtime-targets'
import { enqueueLinkedRun } from '@/lib/linked-computers/run-queue-store'
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
import { parseMentions } from '@/lib/comments/mentions'
import { notifyConversationMentions } from '@/lib/comments/conversation-mentions'
import {
  buildChatDelegationGoals,
  buildDelegationBranchSystemMessage,
  extractAgentMentionsForDelegation,
  buildAgentDelegationBranchPart,
} from '@/lib/conversations/agent-delegation'
import { hermesFeaturesService } from '@/lib/hermes-features/service'
import { buildPromptBudget } from '@/lib/hermes-features/prompt-budget'
import { classifyMessagesPromptIntent } from '@/lib/messages/prompt-profile'
import { councilModeGuidanceLines, getSlashCommandByToken, hermesFeaturesCommandLine, hermesGoalCommandLine, slashCommandInstruction, type SlashCommandPayload } from '@/lib/chat/slash-commands'
import { renderDesignContextPayload } from '@/lib/chat/design-commands'
import { findDesignContextItem } from '@/lib/research/store'
import {
  buildCompressionInputBlock,
  buildCompressionTaskPromptBlock,
  buildConversationHistoryBlock,
  computeCompressionPlan,
} from '@/lib/chat/context-compression'
import {
  applyGoalControl,
  applySubgoalControl,
  buildHermesGoalWorkPrompt,
  parseGoalControl,
  parseSubgoalControl,
  type HermesGoalState,
} from '@/lib/chat/hermes-goal'
import { tryHandleHermesFeaturesSlash } from '@/lib/hermes-features/slash'
import { evaluateSlashCommandAccess } from '@/lib/chat/slash-command-access'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { buildAgentSkillsPromptBlock, collectAgentSkillNames } from '@/lib/chat/agent-skills'
import { CEO_APPROVAL_CARD_RULE_LINES, buildCeoDataDecisionOperatingRuleLines } from '@/lib/agent/ceo-operating-rule'
import { validateMessageModelSelection } from '@/lib/messages/model-catalog'
import { requireReadyLlmCredentialBinding } from '@/lib/llm-providers/bindings'
import { resolveLlmCredentialRuntimeTarget } from '@/lib/llm-providers/sync-targets'
import { ensureFreshXaiCredentialForDispatch } from '@/lib/llm-providers/sync-hermes'
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
import {
  canReadCrossOrgConversationMessage,
  evaluateCrossOrgConversationAccess,
} from '@/lib/conversations/cross-org'
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
      ...(attachment.visibility && typeof attachment.visibility === 'object'
        && Array.isArray((attachment.visibility as { principalIds?: unknown }).principalIds)
        ? {
          visibility: {
            principalIds: (attachment.visibility as { principalIds: unknown[] }).principalIds
              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
          },
        }
        : {}),
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

/**
 * Load the org's latest Design Context (research kind='design', T3) and render
 * a prompt-safe block for design-command slash dispatches. Best-effort: a DB
 * failure or missing record never blocks dispatch — the command guidance still
 * tells the agent how to behave (and to flag when no context exists).
 */
async function loadDesignContextPromptBlock(
  orgId: string,
  companyId?: string | null,
): Promise<string> {
  try {
    const item = await findDesignContextItem(orgId, companyId)
    if (!item?.designContext) return ''
    const block = renderDesignContextPayload(item.designContext)
    return block ? `\n\n${block}\n` : ''
  } catch (error) {
    console.error('[conversation-design-context-load-failed]', {
      orgId,
      message: error instanceof Error ? error.message : String(error),
    })
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

function buildWorkspaceContext(conversation: Conversation, profile: 'read_only' | 'draft' | 'execution' = 'execution'): string {
  const workspace = conversation.workspaceContext
  if (!workspace) return ''
  if (profile === 'read_only') {
    return [
      '[Workspace context — compact]',
      `workspaceId: ${workspace.workspaceId}`,
      `orgId: ${workspace.orgId}`,
      `runtimeTarget: ${workspace.runtimeTarget}`,
      workspace.localWorkingPath || workspace.vpsWorkingPath ? `workingPath: ${workspace.localWorkingPath || workspace.vpsWorkingPath}` : '',
      `agentDomain: ${workspace.agentDomain}`,
      `shareMode: ${workspace.shareMode}`,
      'This is read-only chat context. Read files lazily only when the request requires them.',
      '---',
      '',
    ].filter(Boolean).join('\n')
  }
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
    'For a preview, return a structured rich part with type "project_task_proposal", projectId, bundleId, and tasks. Each task must include title, assigneeAgentId, dependencySequence, reviewerAgentId, requiredCapability, agentEffort, and modelPolicy. Include one custom UI action labelled "Create tasks" (actionId create-chain). Messages creates the durable project tasks from that proposal when Peet confirms — do not require the Hermes run to stay open after the proposal is shown.',
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

    const crossOrgAccess = conversation.crossOrg
      ? await evaluateCrossOrgConversationAccess({ conversation, user, action: 'reply' })
      : null
    if (conversation.crossOrg ? !crossOrgAccess?.allowed : !canAccessConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }
    if (!conversation.crossOrg && !canReplyConversation(user, conversation)) {
      return apiError('You do not have permission to reply in this conversation', 403)
    }
    const foreignCrossOrgParticipant = Boolean(
      conversation.crossOrg && user.orgId !== conversation.crossOrg.ownerOrgId,
    )
    if (!foreignCrossOrgParticipant) {
      const replyAccess = await assertUserCanPerformOrganizationModuleAction(
        user,
        conversation.orgId,
        'messages',
        'reply',
        'Conversation replies are disabled for your organisation role',
      )
      if (!replyAccess.ok) return apiError(replyAccess.error, replyAccess.status)
    }
    let boundProjectId: string | undefined
    if (!foreignCrossOrgParticipant) {
      const projectAuthorization = await authorizeConversationProject(user, conversation)
      if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)
      boundProjectId = projectAuthorization.projectId ?? undefined
    }

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
    const publicAttachments: ConversationAttachment[] = attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      ...(attachment.visibility ? { visibility: attachment.visibility } : {}),
    }))
    const slashCommand = sanitizeSlashCommand((body as Record<string, unknown>).slashCommand)
    // /goal, /toolsets, /memory, /rollback, /design commands, etc. may have empty free-text content.
    if (
      !content
      && attachments.length === 0
      && slashCommand?.executorKind !== 'hermes_goal'
      && slashCommand?.executorKind !== 'hermes_features'
      && slashCommand?.executorKind !== 'design_command'
    ) {
      return apiError('content or attachments are required', 400)
    }
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
    // Foreign-org participants may add user messages, but cannot dispatch an
    // owner-org workspace agent. A foreign agent needs a separately-sanitised
    // execution context; until that exists this prevents workspace/history
    // leakage across the collaboration boundary.
    let dispatchAgentId = await resolveConversationDispatchAgentId(conversation)
    if (foreignCrossOrgParticipant) dispatchAgentId = null
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
          await ensureFreshXaiCredentialForDispatch({
            connectionId: modelSelection.llmConnectionId,
            agentId: dispatchAgentId,
          })
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
    let recoveringLinkedComputerQueue = false
    if (requestedRuntimeTarget && conversation.workspaceContext?.workspaceId && dispatchAgentId) {
      const scopedAccessPolicy = (await loadOrgMemberAccessPolicy(conversation.orgId, user.uid))
        ?? user.memberAccessPolicy
        ?? null
      // Platform admins and Pip are always allowed. Everyone else needs a Team
      // grant, ownership of a personal linked agent, or org-manager rights on a
      // shared organisation agent.
      if (user.role !== 'admin' && dispatchAgentId !== 'pip') {
        const agentSnap = await adminDb.collection('agent_team').doc(dispatchAgentId).get()
        const agentData = agentSnap.exists
          ? agentSnap.data() as {
              provisioningMode?: string
              accessScope?: string
              ownerUserId?: string
              scopeOrgId?: string
            }
          : null
        if (agentData?.provisioningMode === 'linked_device') {
          const granted = memberCanUseAgentOnRuntime(
            scopedAccessPolicy,
            requestedRuntimeTarget,
            dispatchAgentId,
          )
          const ownsPersonalLinkedAgent = agentData.accessScope === 'personal'
            && agentData.ownerUserId === user.uid
          let managesOrgLinkedAgent = false
          if (agentData.accessScope === 'organization' && agentData.scopeOrgId === conversation.orgId) {
            const membership = await adminDb.collection('orgMembers').doc(`${conversation.orgId}_${user.uid}`).get()
            const memberRole = membership.data()?.role
            managesOrgLinkedAgent = memberRole === 'owner' || memberRole === 'admin'
          }
          if (!granted && !ownsPersonalLinkedAgent && !managesOrgLinkedAgent) {
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
      } catch (error) {
        const isRecoverableReadinessLoss = error instanceof LinkedComputerDispatchError
          && (error.code === 'linked_device_offline' || error.code === 'linked_device_stale')
        if (!isRecoverableReadinessLoss) return apiError('Computer unavailable', 409)
        try {
          authorizedWorkspaceRuntime = await authorizeLinkedComputerRecoveryQueue({
            userId: user.uid,
            orgId: conversation.orgId,
            workspaceId: conversation.workspaceContext.workspaceId,
            runtimeTargetId: requestedRuntimeTarget,
            ...(conversation.workspaceContext.mappingId
              ? { mappingId: conversation.workspaceContext.mappingId }
              : {}),
            agentId: dispatchAgentId,
          })
          recoveringLinkedComputerQueue = true
        } catch {
          return apiError('Computer unavailable', 409)
        }
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

    // Slash access control (operator runtime vs public product commands)
    if (slashCommand && (slashCommand.executorKind === 'hermes_features' || slashCommand.executorKind === 'hermes_goal')) {
      const agentIdForAccess = dispatchAgentId || 'pip'
      const agentSnap = await adminDb.collection('agent_team').doc(agentIdForAccess).get()
      const agentRow = agentSnap.exists ? (agentSnap.data() as {
        ownerUserId?: string
        accessScope?: string
        provisioningMode?: string
        scopeOrgId?: string
      }) : null
      const memberSnap = await adminDb.collection('orgMembers').doc(`${conversation.orgId}_${user.uid}`).get()
      const memberRole = memberSnap.exists ? (memberSnap.data() as { role?: string })?.role : undefined
      const orgManager = user.role === 'admin'
        || memberRole === 'owner'
        || memberRole === 'admin'
      const access = evaluateSlashCommandAccess({
        commandId: slashCommand.id,
        args: slashCommand.args,
        actor: {
          uid: user.uid,
          role: user.role,
          isSuperAdmin: isSuperAdmin(user),
          isOrgManager: orgManager,
        },
        conversation: {
          startedBy: conversation.startedBy,
          ownerUserId: conversation.workspaceContext?.ownerUserId ?? null,
        },
        agent: {
          agentId: agentIdForAccess,
          ownerUserId: agentRow?.ownerUserId ?? null,
          accessScope: agentRow?.accessScope ?? null,
          provisioningMode: agentRow?.provisioningMode ?? null,
          scopeOrgId: agentRow?.scopeOrgId ?? null,
        },
      })
      if (!access.allowed) {
        return apiError(access.reason, 403)
      }
    }

    // Hermes features control plane (/toolsets, /memory, /rollback, /personality, /hermes-features)
    if (slashCommand?.executorKind === 'hermes_features' && dispatchAgentId) {
      const featureResult = await tryHandleHermesFeaturesSlash({
        token: slashCommand.token,
        args: slashCommand.args,
        orgId: conversation.orgId,
        agentId: dispatchAgentId,
        conversationId: convId,
        uid: user.uid,
        workspaceContext: conversation.workspaceContext ?? null,
      })
      if (featureResult?.handled) {
        const displayContent = hermesFeaturesCommandLine(slashCommand)
        const userMessage = await createMessage(convId, {
          conversationId: convId,
          role: 'user',
          content: displayContent,
          ...(slashCommand ? { slashCommand } : {}),
          authorKind: 'user',
          authorId: user.uid,
          authorDisplayName,
          status: 'completed',
        })
        await touchConversation(convId, displayContent, 'user', userMessage.id, user.uid)
        const assistantMessage = await createMessage(convId, {
          conversationId: convId,
          role: 'assistant',
          content: featureResult.reply,
          authorKind: 'system',
          authorId: 'system',
          authorDisplayName: 'Hermes Features',
          status: 'completed',
        })
        await touchConversation(convId, featureResult.reply, 'assistant', assistantMessage.id)
        return apiSuccess({ message: userMessage, assistantMessage, hermesFeatures: featureResult.data ?? null }, 201)
      }
    }

    // Hermes /goal + /subgoal: control plane + standing goal state on the conversation.
    // Control replies can complete without a Hermes run; set/resume/add criteria dispatch.
    let hermesGoalWorkPrompt: string | null = null
    if (slashCommand?.executorKind === 'hermes_goal') {
      const existingGoal = (conversation.goalState ?? null) as HermesGoalState | null
      if (slashCommand.id === 'subgoal') {
        const result = applySubgoalControl(existingGoal, parseSubgoalControl(slashCommand.args))
        if (result.state) await patchConversation(convId, { goalState: result.state })
        if (!result.shouldDispatch) {
          const displayContent = hermesGoalCommandLine(slashCommand)
          const userMessage = await createMessage(convId, {
            conversationId: convId,
            role: 'user',
            content: displayContent,
            ...(slashCommand ? { slashCommand } : {}),
            authorKind: 'user',
            authorId: user.uid,
            authorDisplayName,
            status: 'completed',
          })
          await touchConversation(convId, displayContent, 'user', userMessage.id, user.uid)
          const assistantMessage = await createMessage(convId, {
            conversationId: convId,
            role: 'assistant',
            content: result.reply,
            authorKind: 'system',
            authorId: 'system',
            authorDisplayName: 'Goals',
            status: 'completed',
          })
          await touchConversation(convId, result.reply, 'assistant', assistantMessage.id)
          return apiSuccess({ message: userMessage, assistantMessage, goalState: result.state }, 201)
        }
        hermesGoalWorkPrompt = result.state
          ? buildHermesGoalWorkPrompt(result.state, 'continue')
          : null
      } else {
        const result = applyGoalControl(existingGoal, parseGoalControl(slashCommand.args), { uid: user.uid })
        if (result.state) await patchConversation(convId, { goalState: result.state })
        else if (result.state === null && existingGoal) await patchConversation(convId, { goalState: null })
        if (!result.shouldDispatch) {
          const displayContent = hermesGoalCommandLine(slashCommand)
          const userMessage = await createMessage(convId, {
            conversationId: convId,
            role: 'user',
            content: displayContent || '/goal',
            ...(slashCommand ? { slashCommand } : {}),
            authorKind: 'user',
            authorId: user.uid,
            authorDisplayName,
            status: 'completed',
          })
          await touchConversation(convId, displayContent || '/goal', 'user', userMessage.id, user.uid)
          const assistantMessage = await createMessage(convId, {
            conversationId: convId,
            role: 'assistant',
            content: result.reply,
            authorKind: 'system',
            authorId: 'system',
            authorDisplayName: 'Goals',
            status: 'completed',
          })
          await touchConversation(convId, result.reply, 'assistant', assistantMessage.id)
          return apiSuccess({ message: userMessage, assistantMessage, goalState: result.state }, 201)
        }
        hermesGoalWorkPrompt = result.state
          ? buildHermesGoalWorkPrompt(result.state, 'start')
          : (result.dispatchGoal ? buildHermesGoalWorkPrompt({
            status: 'active',
            goal: result.dispatchGoal,
            maxTurns: 20,
            turnsUsed: 0,
            subgoals: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }, 'start') : null)
      }
    }

    // Store the user message
    const userVisibleContent = slashCommand?.executorKind === 'hermes_goal'
      ? (hermesGoalCommandLine(slashCommand) || content || slashCommand.token)
      : slashCommand?.executorKind === 'design_command'
        ? (content || (slashCommand.args ? `${slashCommand.token} ${slashCommand.args}` : slashCommand.token))
        : content
    const mentions = parseMentions(userVisibleContent)
    const mentionIds = mentions.map(({ id, type }) => `${type}:${id}`)
    const message = await createMessage(convId, {
      conversationId: convId,
      role: 'user',
      content: userVisibleContent,
      ...(mentions.length ? { mentions } : {}),
      ...(mentionIds.length ? { mentionIds } : {}),
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
    const preview = userVisibleContent || publicAttachments.map((attachment) => attachment.name).join(', ')
    await touchConversation(convId, preview, 'user', message.id, user.uid)
    if (mentions.some((m) => m.type === 'user')) {
      notifyConversationMentions({
        orgId: conversation.orgId,
        conversationId: convId,
        messageId: message.id,
        mentions,
        actorName: authorDisplayName,
        snippet: userVisibleContent.slice(0, 100),
      }).catch((error) => console.error('notifyConversationMentions failed:', error))
    }

    // Chat-native @agent branches: spawn isolated specialist children for tagged
    // agents that are not the primary dispatcher (Hermes-style goal+context only).
    let branchMessage: Awaited<ReturnType<typeof createMessage>> | null = null
    let branchRecord: Awaited<ReturnType<typeof hermesFeaturesService.spawnObservableDelegations>> | null = null
    const branchAgentIds = extractAgentMentionsForDelegation(mentions, {
      excludeAgentIds: dispatchAgentId ? [dispatchAgentId] : [],
    })
    if (branchAgentIds.length > 0) {
      try {
        const goals = buildChatDelegationGoals({
          agentIds: branchAgentIds,
          messageContent: userVisibleContent,
          parentAgentId: dispatchAgentId,
          parentMessageId: message.id,
          conversationId: convId,
          actorDisplayName: authorDisplayName,
        })
        branchRecord = await hermesFeaturesService.spawnObservableDelegations({
          orgId: conversation.orgId,
          agentId: dispatchAgentId || 'pip',
          conversationId: convId,
          parentRunHint: `messages:${convId}:msg:${message.id}`,
          goals,
        })
        const systemMsg = buildDelegationBranchSystemMessage({
          conversationId: convId,
          record: branchRecord,
        })
        branchMessage = await createMessage(convId, systemMsg)
        await touchConversation(convId, branchMessage.content.slice(0, 200), 'system', branchMessage.id)
        // Link branch card so cron/finalizer can patch status + re-enter summary.
        branchRecord = await hermesFeaturesService.attachDelegationBranchMessage(
          conversation.orgId,
          branchRecord.id,
          branchMessage.id,
        )
      } catch (error) {
        console.error('agent branch spawn failed:', error)
      }
    }
    const branchPayload = branchMessage
      ? {
          branchMessage: publicConversationMessageView(branchMessage),
          ...(branchRecord ? { branch: buildAgentDelegationBranchPart(branchRecord) } : {}),
        }
      : {}

    // Ordinary answers fetch exactly the history that can enter the prompt. The
    // broad read is reserved for an explicit, auditable /compress operation.
    const historyLimit = slashCommand?.id === 'compress' ? 200 : 31
    const historyFetchLimit = slashCommand?.id === 'compress' ? 200 : 31
    const recentMessages = await listMessages(convId, historyFetchLimit).catch(() => [message])
    // /compress: plan where to cut (older messages → summary input; latest
    // exchanges stay intact). A real compress falls through to dispatch; the
    // run's reply is stored as durable conversation context compression.
    const compressPlan = slashCommand?.id === 'compress'
      ? computeCompressionPlan(recentMessages, message.id, slashCommand.args)
      : null
    const conversationHistory = compressPlan
      ? buildCompressionInputBlock(recentMessages, message.id, compressPlan)
      : buildConversationHistoryBlock(recentMessages, message.id, conversation.contextCompression ?? null)
    const compressionTaskContext = compressPlan
      ? buildCompressionTaskPromptBlock(compressPlan)
      : ''

    // Phase 2: dispatch a Hermes run. Multi-agent conversations route via Pip.
    if (dispatchAgentId) {
      const agentId = dispatchAgentId
      const promptIntent = classifyMessagesPromptIntent({
        content: content || hermesGoalWorkPrompt || '',
        hasAttachments: attachments.length > 0,
        slashExecutorKind: slashCommand?.executorKind,
        hasProject: Boolean(boundProjectId),
      })

      // Read agent doc from Firestore
      const agentSnap = await adminDb.collection('agent_team').doc(agentId).get()
      if (!agentSnap.exists) {
        return apiSuccess({
          message: publicConversationMessageView(message),
          ...branchPayload,
        }, 201)
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
        ...(compressPlan ? { contextCompressionPlan: compressPlan } : {}),
        ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        ...(modelSelection?.provider ? { provider: modelSelection.provider } : {}),
        ...(modelSelection?.llmConnectionId ? { llmConnectionId: modelSelection.llmConnectionId } : {}),
        ...(modelSelection?.llmCredentialBindingId ? { llmCredentialBindingId: modelSelection.llmCredentialBindingId } : {}),
        status: 'pending',
      })

      // Never leave a pending assistant orphan: any throw after createMessage
      // must mark the message failed with a client-visible error (not a raw 500).
      try {

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
      const workspaceContext = buildWorkspaceContext(conversation, promptIntent.profile)
      const orchestrationContext = buildOrchestrationContext(conversation, agentId)
      const projectChatOrchestrationContext = promptIntent.needsProjectOrchestration
        ? buildProjectChatOrchestrationContext({
          conversation,
          dispatchAgentId: agentId,
          requestMessageId: message.id,
          responseMessageId: assistantMessage.id,
        })
        : ''
      const studioArtifactOrchestrationContext = promptIntent.needsStudio
        ? buildStudioArtifactOrchestrationContext({
          dispatchAgentId: agentId,
          conversationId: convId,
          requestMessageId: message.id,
          responseMessageId: assistantMessage.id,
        })
        : ''
      const agentSkillsContext = buildAgentSkillsPromptBlock(agentData, agentId)
      const decisionDataRuleContext = promptIntent.needsCeoDecisionRules
        ? buildDecisionDataOperatingRuleContext()
        : ''
      const attachedContext = buildAttachedContextBlock(resolvedContextRefs)
      const commandContext = slashCommand ? slashCommandInstruction(slashCommand) : ''
      // Design commands (T1 detector + T3 design context): inject the client's
      // latest Design Context record so the agent resolves and cites it.
      const designContextBlock = slashCommand?.executorKind === 'design_command'
        ? await loadDesignContextPromptBlock(conversation.orgId, conversation.workspaceContext?.companyId ?? null)
        : ''
      const goalWorkContext = hermesGoalWorkPrompt
        ? `\n\n${hermesGoalWorkPrompt}\n\n`
        : ''
      const attachmentContext = publicAttachments.length > 0
        ? `\n\n[Attachments]\n${publicAttachments.map((attachment) => `- ${attachment.name}: ${attachment.url} (${attachment.contentType}, ${attachment.sizeBytes} bytes)`).join('\n')}`
        : ''
      // Hermes Features control-plane enrichment is best-effort. A durable-store
      // failure must never block gateway dispatch (that previously surfaced as
      // "Agent run could not be started on the gateway (... reading 'collection')").
      let hermesFeaturesContext = ''
      try {
        const workspaceRoot = hermesFeaturesService.resolveWorkspaceRootFromConversation(
          conversation.workspaceContext ?? null,
        )
        const workspaceFs = workspaceRoot
          ? hermesFeaturesService.createNodeWorkspaceFs(workspaceRoot)
          : null
        const skillNames = collectAgentSkillNames(agentData)
        const userTurnForSkills = content || hermesGoalWorkPrompt || ''
        // On-demand skills: only metadata is in the initial prompt; Hermes loads a
        // single allowlisted body later through skill_view when it is actually used.
        const { loadProgressiveSkillBodies } = await import('@/lib/hermes-features/skill-loader')
        const progressive = loadProgressiveSkillBodies(skillNames, userTurnForSkills)
        if (progressive.catalog.length > 0) {
          await hermesFeaturesService.setSkillCatalog(
            conversation.orgId,
            agentId,
            progressive.catalog.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              path: s.path,
              tags: s.tags,
            })),
          )
        }
        const hermesFeaturesDispatch = await hermesFeaturesService.buildDispatchBlock({
          orgId: conversation.orgId,
          agentId,
          conversationId: convId,
          userMessage: userTurnForSkills,
          workspace: workspaceFs || undefined,
          skillBodies: progressive.bodies,
          skillCatalog: progressive.catalog,
          autoCheckpoint: promptIntent.needsWorkspaceWriteContext,
          includeWorkspaceInstructions: promptIntent.needsWorkspaceWriteContext,
        })
        hermesFeaturesContext = hermesFeaturesDispatch.block
          ? `\n\n${hermesFeaturesDispatch.block}\n`
          : ''
      } catch (featuresErr) {
        console.error('[conversation-hermes-features-enrichment-failed]', {
          convId,
          agentId,
          message: featuresErr instanceof Error ? featuresErr.message : String(featuresErr),
        })
      }
      // Every human-triggered Hermes turn gets a fresh pib_dlg_. Never reuse a
      // stale token from an earlier turn or a cached Hermes conversation blob.
      const mintedDelegation = await mintFreshMessagesTurnDelegation({
        user,
        orgId: conversation.orgId,
        agentId,
        conversationId: convId,
      })
      const mailboxAccounts = promptIntent.needsMailbox
        ? await listMailboxAccountsForUser(conversation.orgId, user.uid).catch(() => [])
        : []
      const dynamicChatCanvasContext = promptIntent.needsCanvas
        ? buildDynamicChatCanvasPromptBlock({
          conversationId: convId,
          responseMessageId: assistantMessage.id,
        })
        : ''
      const mailboxContext = promptIntent.needsMailbox
        ? buildMailboxContextPromptBlock({
          orgId: conversation.orgId,
          uid: user.uid,
          accounts: mailboxAccounts,
          mailboxDelegationEvidenceId: mintedDelegation?.mailboxDelegationEvidenceId,
          conversationId: convId,
          responseMessageId: assistantMessage.id,
        })
        : ''
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
      // For /goal set, prefer the goal work prompt as the actionable user request.
      const userTurnContent = hermesGoalWorkPrompt
        ? `${goalWorkContext}${content ? `User message:\n${content}` : ''}`.trim()
        : content
      const promptAssembly = buildPromptBudget({
        profile: promptIntent.profile,
        blocks: [
        // Critical/high contract blocks stay uncapped so identity, request, and
        // decision rules cannot be starved by metadata headroom.
        { id: 'org_identity', content: orgContext, priority: 'critical', required: true },
        { id: 'conversation_identity', content: convContext, priority: 'critical', required: true },
        { id: 'latest_request', content: userTurnContent, priority: 'critical', required: true },
        { id: 'task_or_project_contract', content: projectChatOrchestrationContext, priority: 'high' },
        { id: 'attached_references', content: attachedContext, priority: 'high', maxTokens: 2_000 },
        { id: 'conversation_history', content: conversationHistory, priority: 'high', maxTokens: 22_000 },
        { id: 'workspace', content: workspaceContext, priority: 'normal', maxTokens: 2_000 },
        { id: 'orchestration', content: orchestrationContext, priority: 'normal', maxTokens: 1_400 },
        { id: 'agent_skills_catalogue', content: agentSkillsContext, priority: 'normal', maxTokens: 2_400 },
        { id: 'hermes_features', content: hermesFeaturesContext, priority: 'normal', maxTokens: 6_000 },
        { id: 'approval_and_decision_rules', content: decisionDataRuleContext, priority: 'high' },
        { id: 'delegation', content: delegationAuthContext, priority: 'critical', required: Boolean(delegationAuthContext) },
        { id: 'canvas', content: dynamicChatCanvasContext, priority: 'optional', maxTokens: 1_500 },
        { id: 'mailbox', content: mailboxContext, priority: 'optional', maxTokens: 1_500 },
        { id: 'studio', content: studioArtifactOrchestrationContext, priority: 'optional', maxTokens: 1_500 },
        { id: 'design_context', content: designContextBlock, priority: 'optional', maxTokens: 1_500 },
        { id: 'slash_command', content: commandContext, priority: 'high' },
        { id: 'compression_task', content: compressionTaskContext, priority: 'high' },
        { id: 'attachments', content: attachmentContext, priority: 'normal', maxTokens: 2_000 },
        ],
      })
      const hermesInput = promptAssembly.content
      // The immutable per-run ledger is visible with the pending assistant
      // message and copied into direct-run metadata below for audit/benchmarking.
      await messagesCollection(convId).doc(assistantMessage.id).update({
        contextLedger: promptAssembly.ledger,
      })
      // VPS-hosted "linked computers" (hermes-vps-01) already expose Hermes
      // /v1/runs publicly. Prefer direct gateway dispatch so chat does not depend
      // on pib-runtime claim queues. Keep the claim queue for Mac/desktop runtimes.
      const vpsLinkedComputer = linkedComputerBinding?.deviceKind === 'vps'
      if (linkedComputerBinding && vpsLinkedComputer) {
        agentLink = await getAgentDispatchHermesProfileLink(agentId, conversation.orgId, {
          runtimeTarget: 'vps',
        })
        if (!agentLink) {
          throw new Error('No VPS Hermes endpoint configured for this agent')
        }
        // Preserve VPS cowork path via the direct Hermes working_directory path below.
        linkedComputerBinding = null
      }
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
        const preferVps = linkedComputerBinding.deviceKind === 'vps'
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
        try {
          // Only watcher-created Kanban conversations carry this server-side marker.
          // It is passed at enqueue time so a fast desktop claim cannot race the
          // later Firestore annotation used by the legacy fallback path.
          const conversationTaskMarker = conversation as unknown as { kanbanTaskId?: unknown }
          const kanbanTaskId = typeof conversationTaskMarker.kanbanTaskId === 'string'
            ? conversationTaskMarker.kanbanTaskId.trim()
            : ''
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
            ...(kanbanTaskId ? { kanbanTaskId } : {}),
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
            ...(mintedDelegation ? { delegationId: mintedDelegation.id } : {}),
            ...(recoveringLinkedComputerQueue ? { queuedReason: 'runtime_restarting' as const } : {}),
          })
          const queuedAssistant = {
            ...assistantMessage,
            status: 'queued' as const,
            runId: queued.jobId,
            dispatchAgentId: agentId,
            dispatchRuntimeTargetId: linkedComputerBinding.runtimeTargetId,
            dispatchRuntimeKind: 'linked-computer',
            dispatchRuntimeLabel: linkedComputerBinding.machineLabel,
            linkedDeviceId: linkedComputerBinding.deviceId,
            linkedDeviceMappingId: boundProjectReplica?.mappingId || linkedComputerBinding.mappingId,
            linkedDeviceCredentialVersion: linkedComputerBinding.credentialVersion,
            ...(mintedDelegation ? { delegationId: mintedDelegation.id } : {}),
            ...(recoveringLinkedComputerQueue ? { queuedReason: 'runtime_restarting' as const } : {}),
          }
          await messagesCollection(convId).doc(assistantMessage.id).update({
            status: 'queued',
            runId: queued.jobId,
            dispatchAgentId: agentId,
            dispatchRuntimeTargetId: linkedComputerBinding.runtimeTargetId,
            dispatchRuntimeKind: 'linked-computer',
            dispatchRuntimeLabel: linkedComputerBinding.machineLabel,
            linkedDeviceId: linkedComputerBinding.deviceId,
            linkedDeviceMappingId: boundProjectReplica?.mappingId || linkedComputerBinding.mappingId,
            linkedDeviceCredentialVersion: linkedComputerBinding.credentialVersion,
            ...(mintedDelegation ? { delegationId: mintedDelegation.id } : {}),
            ...(recoveringLinkedComputerQueue ? { queuedReason: 'runtime_restarting' as const } : {}),
          })
          return apiSuccess({
            message,
            assistantMessage: queuedAssistant,
            runId: queued.jobId,
            dispatchAgentId: agentId,
          }, 201)
        } catch (linkedErr) {
          // A selected linked computer is an exact dispatch binding. Never
          // silently send its work to another machine if its durable queue is
          // unavailable; the user can retry without losing that boundary.
          console.error('[conversation-linked-enqueue-fallback]', {
            convId,
            agentId,
            message: linkedErr instanceof Error ? linkedErr.message : String(linkedErr),
          })
          const error = recoveringLinkedComputerQueue
            ? 'This computer is reconnecting, but its local queue is temporarily unavailable. It was not sent to another computer; please retry shortly.'
            : 'The selected computer could not accept this message. It was not sent to another computer; please retry shortly.'
          await messagesCollection(convId).doc(assistantMessage.id).update({
            content: '',
            status: 'failed',
            error,
            workspaceDispatchFailureCode: 'linked_device_queue_unavailable',
          })
          return apiSuccess({
            message,
            assistantMessage: {
              ...assistantMessage,
              status: 'failed',
              error,
              workspaceDispatchFailureCode: 'linked_device_queue_unavailable',
            },
          }, 201)
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
          promptProfile: promptIntent.profile,
          contextLedger: promptAssembly.ledger,
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
            ...branchPayload,
          },
          201,
        )
      }

      const rejected = runResult.dispatchError?.message
        || 'Agent run could not be started on the gateway'
      await messagesCollection(convId).doc(assistantMessage.id).update({
        content: '',
        status: 'failed',
        error: rejected,
        ...(runResult.dispatchError?.code
          ? { workspaceDispatchFailureCode: runResult.dispatchError.code }
          : { workspaceDispatchFailureCode: 'dispatch_unavailable' }),
      })

      return apiSuccess({
        message,
        assistantMessage: {
          ...assistantMessage,
          status: 'failed',
          error: rejected,
        },
        ...branchPayload,
      }, 201)
      } catch (dispatchErr) {
        const safeFailure = classifyWorkspaceDispatchFailure(dispatchErr)
        const detail = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr)
        console.error('[conversation-agent-dispatch-uncaught]', {
          convId,
          agentId,
          code: safeFailure.code,
          message: detail,
        })
        // Keep a short safe detail so operators can see the real fault in-thread.
        const safeDetail = detail
          .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
          .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[redacted]')
          .slice(0, 180)
        const error = safeDetail && safeDetail !== safeFailure.message
          ? `${safeFailure.message} (${safeDetail})`
          : safeFailure.message
        try {
          await messagesCollection(convId).doc(assistantMessage.id).update({
            content: '',
            status: 'failed',
            error,
            workspaceDispatchFailureCode: safeFailure.code,
          })
        } catch (updateErr) {
          console.error('[conversation-agent-dispatch-fail-update]', updateErr)
        }
        return apiSuccess({
          message,
          assistantMessage: {
            ...assistantMessage,
            status: 'failed',
            error,
            workspaceDispatchFailureCode: safeFailure.code,
          },
          ...branchPayload,
        }, 201)
      }
    }

    return apiSuccess({ message, ...branchPayload }, 201)
  },
)

const listMessagesHandler = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    const access = conversation.crossOrg
      ? await evaluateCrossOrgConversationAccess({ conversation, user, action: 'read' })
      : null
    if (conversation.crossOrg ? !access?.allowed : !canAccessConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }

    const foreignCrossOrgParticipant = Boolean(
      conversation.crossOrg && user.orgId !== conversation.crossOrg.ownerOrgId,
    )
    if (!foreignCrossOrgParticipant) {
      const projectAuthorization = await authorizeConversationProject(user, conversation)
      if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)
    }

    const messages = await listMessages(convId, 200)
    const visibleMessages = conversation.crossOrg
      ? (await Promise.all(messages.map(async (message) => (
        await canReadCrossOrgConversationMessage({ conversation, message, user }) ? message : null
      )))).filter((message): message is ConversationMessage => message !== null)
      : messages
    return apiSuccess({ messages: visibleMessages.map(publicConversationMessageView) })
  },
)

export const GET = (req: NextRequest, context?: unknown) =>
  runWithFirestoreReadAudit(
    'api/v1/conversations/:id/messages:get',
    () => listMessagesHandler(req, context),
    { logEveryRun: true },
  )
