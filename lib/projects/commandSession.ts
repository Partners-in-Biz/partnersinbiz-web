/**
 * Project Command Session — bind a Messages conversation as the project's
 * command room. Task lifecycle events feed into that chat; optional auto-wake
 * asks the lead agent to act using prior chat context.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { createMessage, getConversation, touchConversation, messagesCollection } from '@/lib/conversations/conversations'
import { createHermesRun } from '@/lib/hermes/server'
import { getAgentDispatchHermesProfileLink } from '@/lib/agents/team'
import type { AgentId, ConversationMessage } from '@/lib/conversations/types'

export const PROJECT_COMMAND_EVENT_TYPES = [
  'task.started',
  'task.done',
  'task.blocked',
  'task.awaiting_input',
  'task.failed',
  'session.bound',
  'session.unbound',
  'agent.wake_result',
] as const

export type ProjectCommandEventType = (typeof PROJECT_COMMAND_EVENT_TYPES)[number]

export type ProjectCommandAutoWakeOn = 'blocked' | 'awaiting_input' | 'done' | 'started' | 'failed'

export interface ProjectCommandSessionBinding {
  conversationId: string
  orgId: string
  enabled: boolean
  boundAt: string
  boundBy: string
  autoWake: boolean
  autoWakeAgentId: AgentId
  autoWakeOn: ProjectCommandAutoWakeOn[]
}

export interface ProjectCommandEvent {
  schemaVersion: 1
  type: ProjectCommandEventType
  projectId: string
  projectName?: string
  taskId?: string
  taskTitle?: string
  agentId?: string
  summary?: string
  blockingReason?: string
  requiredEvidence?: string
  messageForAgent?: string
  runId?: string | null
  taskHref?: string
  occurredAt: string
  idempotencyKey: string
}

const DEFAULT_AUTO_WAKE_ON: ProjectCommandAutoWakeOn[] = ['blocked', 'awaiting_input']

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nowIso(): string {
  return new Date().toISOString()
}

export function normalizeCommandSession(value: unknown): ProjectCommandSessionBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const conversationId = clean(raw.conversationId)
  const orgId = clean(raw.orgId)
  if (!conversationId || !orgId) return null
  const autoWakeOn = Array.isArray(raw.autoWakeOn)
    ? raw.autoWakeOn.filter((item): item is ProjectCommandAutoWakeOn => (
      item === 'blocked' || item === 'awaiting_input' || item === 'done' || item === 'started' || item === 'failed'
    ))
    : DEFAULT_AUTO_WAKE_ON
  return {
    conversationId,
    orgId,
    enabled: raw.enabled !== false,
    boundAt: clean(raw.boundAt) || nowIso(),
    boundBy: clean(raw.boundBy) || 'system',
    autoWake: raw.autoWake !== false,
    autoWakeAgentId: (clean(raw.autoWakeAgentId) || 'pip') as AgentId,
    autoWakeOn: autoWakeOn.length > 0 ? autoWakeOn : DEFAULT_AUTO_WAKE_ON,
  }
}

export function taskHrefFor(projectId: string, taskId: string, orgSlug?: string): string {
  if (orgSlug) return `/admin/org/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(taskId)}`
  return `/portal/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(taskId)}`
}

export function formatCommandEventContent(event: ProjectCommandEvent): string {
  const title = event.taskTitle || event.taskId || 'Task'
  const agent = event.agentId ? ` · ${event.agentId}` : ''
  switch (event.type) {
    case 'task.started':
      return `**Project update · Started**${agent}\n\n${title}${event.summary ? `\n\n${event.summary}` : ''}${event.taskHref ? `\n\n[Open task](${event.taskHref})` : ''}`
    case 'task.done':
      return `**Project update · Done**${agent}\n\n${title}${event.summary ? `\n\n${event.summary}` : ''}${event.taskHref ? `\n\n[Open task](${event.taskHref})` : ''}`
    case 'task.blocked':
      return `**Project update · Blocked**${agent}\n\n${title}\n\n**Blocker:** ${event.blockingReason || event.summary || 'Unknown'}${event.requiredEvidence ? `\n\n**Proof needed:** ${event.requiredEvidence}` : ''}${event.messageForAgent ? `\n\n**Agent note:** ${event.messageForAgent}` : ''}${event.taskHref ? `\n\n[Open task](${event.taskHref})` : ''}`
    case 'task.awaiting_input':
      return `**Project update · Needs you**${agent}\n\n${title}\n\n**What is needed:** ${event.blockingReason || event.summary || 'Human input'}${event.requiredEvidence ? `\n\n**Proof needed:** ${event.requiredEvidence}` : ''}${event.messageForAgent ? `\n\n**Message for agent when resolved:** ${event.messageForAgent}` : ''}${event.taskHref ? `\n\n[Open task](${event.taskHref})` : ''}`
    case 'task.failed':
      return `**Project update · Failed**${agent}\n\n${title}${event.summary ? `\n\n${event.summary}` : ''}${event.taskHref ? `\n\n[Open task](${event.taskHref})` : ''}`
    case 'session.bound':
      return `**Command session linked**\n\nThis chat is now the command room for **${event.projectName || event.projectId}**. Task starts, completions, blocks, and needs-you events will appear here.${event.summary ? `\n\n${event.summary}` : ''}`
    case 'session.unbound':
      return `**Command session unlinked**\n\nThis chat is no longer the command room for **${event.projectName || event.projectId}**.`
    case 'agent.wake_result':
      return event.summary || 'Agent reviewed the project update.'
    default:
      return event.summary || 'Project update'
  }
}

export async function bindProjectCommandSession(input: {
  projectId: string
  conversationId: string
  orgId: string
  boundBy: string
  autoWake?: boolean
  autoWakeAgentId?: AgentId
  autoWakeOn?: ProjectCommandAutoWakeOn[]
}): Promise<ProjectCommandSessionBinding> {
  const conversation = await getConversation(input.conversationId)
  if (!conversation) throw new Error('Conversation not found')
  if (conversation.orgId !== input.orgId) throw new Error('Conversation organisation mismatch')
  const projectScoped = conversation.scope === 'project' && conversation.scopeRefId === input.projectId
  const contextLinked = (conversation.contextRefs ?? []).some((ref) => ref.type === 'project' && ref.id === input.projectId)
  if (!projectScoped && !contextLinked) {
    throw new Error('Conversation must be scoped to this project or pin the project as context')
  }

  const binding: ProjectCommandSessionBinding = {
    conversationId: input.conversationId,
    orgId: input.orgId,
    enabled: true,
    boundAt: nowIso(),
    boundBy: input.boundBy,
    autoWake: input.autoWake !== false,
    autoWakeAgentId: (input.autoWakeAgentId || 'pip') as AgentId,
    autoWakeOn: input.autoWakeOn?.length ? input.autoWakeOn : DEFAULT_AUTO_WAKE_ON,
  }

  const projectRef = adminDb.collection('projects').doc(input.projectId)
  const projectSnap = await projectRef.get()
  if (!projectSnap.exists) throw new Error('Project not found')
  const projectName = clean(projectSnap.data()?.name) || input.projectId

  // Clear previous reverse pointer if rebinding
  const previous = normalizeCommandSession(projectSnap.data()?.commandSession)
  if (previous && previous.conversationId !== input.conversationId) {
    await adminDb.collection('conversations').doc(previous.conversationId).set({
      commandSessionProjectId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {})
  }

  await projectRef.set({ commandSession: binding, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  await adminDb.collection('conversations').doc(input.conversationId).set({
    commandSessionProjectId: input.projectId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await publishProjectCommandEvent({
    projectId: input.projectId,
    projectName,
    orgId: input.orgId,
    event: {
      schemaVersion: 1,
      type: 'session.bound',
      projectId: input.projectId,
      projectName,
      summary: `Bound by ${input.boundBy}. Auto-wake: ${binding.autoWake ? `on for ${binding.autoWakeOn.join(', ')}` : 'off'}.`,
      occurredAt: nowIso(),
      idempotencyKey: `session.bound:${input.projectId}:${input.conversationId}:${binding.boundAt}`,
    },
    forceConversationId: input.conversationId,
    allowWake: false,
  })

  return binding
}

export async function unbindProjectCommandSession(input: {
  projectId: string
  unboundBy: string
}): Promise<void> {
  const projectRef = adminDb.collection('projects').doc(input.projectId)
  const projectSnap = await projectRef.get()
  if (!projectSnap.exists) throw new Error('Project not found')
  const previous = normalizeCommandSession(projectSnap.data()?.commandSession)
  const projectName = clean(projectSnap.data()?.name) || input.projectId
  const orgId = clean(projectSnap.data()?.orgId) || previous?.orgId || ''

  await projectRef.set({
    commandSession: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  if (previous?.conversationId) {
    await adminDb.collection('conversations').doc(previous.conversationId).set({
      commandSessionProjectId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {})

    if (orgId) {
      await publishProjectCommandEvent({
        projectId: input.projectId,
        projectName,
        orgId,
        event: {
          schemaVersion: 1,
          type: 'session.unbound',
          projectId: input.projectId,
          projectName,
          summary: `Unbound by ${input.unboundBy}.`,
          occurredAt: nowIso(),
          idempotencyKey: `session.unbound:${input.projectId}:${previous.conversationId}:${nowIso()}`,
        },
        forceConversationId: previous.conversationId,
        allowWake: false,
      }).catch(() => {})
    }
  }
}

export async function resolveCommandConversationId(input: {
  projectId: string
  taskChatOriginConversationId?: string | null
}): Promise<{ conversationId: string; binding: ProjectCommandSessionBinding | null } | null> {
  const projectSnap = await adminDb.collection('projects').doc(input.projectId).get()
  const binding = normalizeCommandSession(projectSnap.data()?.commandSession)
  if (binding?.enabled && binding.conversationId) {
    return { conversationId: binding.conversationId, binding }
  }
  const fromTask = clean(input.taskChatOriginConversationId)
  if (fromTask) return { conversationId: fromTask, binding: null }
  return null
}

async function claimIdempotency(projectId: string, key: string): Promise<boolean> {
  const ref = adminDb.collection('projects').doc(projectId).collection('commandSessionEvents').doc(key.slice(0, 700))
  try {
    await ref.create({
      idempotencyKey: key,
      createdAt: FieldValue.serverTimestamp(),
    })
    return true
  } catch {
    return false
  }
}

export async function publishProjectCommandEvent(input: {
  projectId: string
  projectName?: string
  orgId: string
  event: ProjectCommandEvent
  forceConversationId?: string
  taskChatOriginConversationId?: string | null
  allowWake?: boolean
}): Promise<{ conversationId: string; messageId: string } | null> {
  const target = input.forceConversationId
    ? { conversationId: input.forceConversationId, binding: normalizeCommandSession(
        (await adminDb.collection('projects').doc(input.projectId).get()).data()?.commandSession,
      ) }
    : await resolveCommandConversationId({
        projectId: input.projectId,
        taskChatOriginConversationId: input.taskChatOriginConversationId,
      })
  if (!target) return null

  const claimed = await claimIdempotency(input.projectId, input.event.idempotencyKey)
  if (!claimed) return null

  const conversation = await getConversation(target.conversationId)
  if (!conversation || conversation.archived) return null

  const event: ProjectCommandEvent = {
    ...input.event,
    projectName: input.event.projectName || input.projectName,
  }
  const content = formatCommandEventContent(event)
  const message = await createMessage(target.conversationId, {
    conversationId: target.conversationId,
    role: 'system',
    content,
    status: 'completed',
    authorKind: 'system',
    authorId: 'system:project-command',
    authorDisplayName: 'Project command',
    projectCommandEvent: event as unknown as Record<string, unknown>,
    richParts: [{ type: 'project_command_event', event } as unknown as ConversationMessage['richParts'] extends (infer T)[] | undefined ? T : never],
  })

  await touchConversation(target.conversationId, content.replace(/\s+/g, ' ').slice(0, 180), 'system', message.id)

  const binding = target.binding
  const shouldWake = input.allowWake !== false
    && binding?.enabled
    && binding.autoWake
    && shouldAutoWakeForEvent(binding, event.type)

  if (shouldWake && binding) {
    await wakeCommandAgent({
      conversationId: target.conversationId,
      orgId: input.orgId,
      projectId: input.projectId,
      projectName: event.projectName || input.projectName || input.projectId,
      agentId: binding.autoWakeAgentId,
      event,
    }).catch((error) => {
      console.error('[command-session] auto-wake failed', error)
    })
  }

  return { conversationId: target.conversationId, messageId: message.id }
}

function shouldAutoWakeForEvent(
  binding: ProjectCommandSessionBinding,
  type: ProjectCommandEventType,
): boolean {
  if (type === 'task.blocked') return binding.autoWakeOn.includes('blocked')
  if (type === 'task.awaiting_input') return binding.autoWakeOn.includes('awaiting_input')
  if (type === 'task.done') return binding.autoWakeOn.includes('done')
  if (type === 'task.started') return binding.autoWakeOn.includes('started')
  if (type === 'task.failed') return binding.autoWakeOn.includes('failed')
  return false
}

async function loadRecentChatTranscript(conversationId: string, limit = 12): Promise<string> {
  const snap = await messagesCollection(conversationId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()
  const lines = snap.docs.reverse().map((doc) => {
    const data = doc.data() as ConversationMessage
    const who = data.authorDisplayName || data.authorId || data.role
    const body = (data.content || '').replace(/\s+/g, ' ').trim().slice(0, 500)
    return `${who}: ${body}`
  })
  return lines.join('\n')
}

async function wakeCommandAgent(input: {
  conversationId: string
  orgId: string
  projectId: string
  projectName: string
  agentId: AgentId
  event: ProjectCommandEvent
}): Promise<void> {
  const transcript = await loadRecentChatTranscript(input.conversationId)
  const prompt = [
    'You are the project command agent for Partners in Biz.',
    `Project: ${input.projectName} (${input.projectId})`,
    `Command conversation: ${input.conversationId}`,
    '',
    'A Kanban task lifecycle event just arrived in this command session.',
    `Event type: ${input.event.type}`,
    `Task: ${input.event.taskTitle || input.event.taskId || 'unknown'}`,
    input.event.agentId ? `Assignee agent: ${input.event.agentId}` : '',
    input.event.summary ? `Summary: ${input.event.summary}` : '',
    input.event.blockingReason ? `Blocker: ${input.event.blockingReason}` : '',
    input.event.requiredEvidence ? `Proof needed: ${input.event.requiredEvidence}` : '',
    input.event.messageForAgent ? `Message for agent: ${input.event.messageForAgent}` : '',
    input.event.taskHref ? `Task link: ${input.event.taskHref}` : '',
    '',
    'Recent command-chat transcript (most recent last):',
    transcript || '(empty)',
    '',
    'Instructions:',
    '1. Use prior instructions already given in this chat if they resolve the event.',
    '2. If the task is blocked or needs input and you can safely act from prior chat decisions, do so via platform APIs (task comment, unblock, requeue, create follow-up task).',
    '3. If you lack authority or evidence, tell the human exactly what is needed in one short reply.',
    '4. Do not bypass production deploy, spend, publish, finance, client-send, secret/config, or destructive approval gates.',
    '5. Keep the reply concise and actionable.',
  ].filter(Boolean).join('\n')

  const pending = await createMessage(input.conversationId, {
    conversationId: input.conversationId,
    role: 'assistant',
    content: '',
    status: 'pending',
    authorKind: 'agent',
    authorId: input.agentId,
    authorDisplayName: input.agentId,
    dispatchAgentId: input.agentId,
  })

  try {
    const link = await getAgentDispatchHermesProfileLink(input.agentId, input.orgId)
    if (!link) throw new Error(`No Hermes dispatch link for agent ${input.agentId}`)
    const run = await createHermesRun(link, `command-session-wake:${input.projectId}`, {
      prompt,
      conversation_id: input.conversationId,
      metadata: {
        orgId: input.orgId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        messageId: pending.id,
        dispatchAgentId: input.agentId,
        source: 'project-command-session',
        eventType: input.event.type,
        taskId: input.event.taskId ?? null,
      },
    })
    if (!run.ok) {
      throw new Error(`Hermes wake rejected (${run.status})`)
    }
    const payload = run.data as { runId?: string | null; status?: string; output?: string }
    const runId = typeof payload.runId === 'string' ? payload.runId : null

    let finalContent = typeof payload.output === 'string' ? payload.output.trim() : ''
    if (runId && !finalContent) {
      finalContent = await pollHermesOutput(link.baseUrl, link.apiKey, runId)
    }
    if (!finalContent) finalContent = 'I reviewed the project update and have no further action yet. Tell me how you want to proceed.'

    await messagesCollection(input.conversationId).doc(pending.id).update({
      content: finalContent,
      status: 'completed',
      runId: runId ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    })
    await touchConversation(input.conversationId, finalContent.slice(0, 180), 'assistant', pending.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await messagesCollection(input.conversationId).doc(pending.id).update({
      content: '',
      status: 'failed',
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
    throw error
  }
}

async function pollHermesOutput(baseUrl: string, apiKey: string, runId: string): Promise<string> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/runs/${encodeURIComponent(runId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!response.ok) continue
      const data = await response.json() as Record<string, unknown>
      const status = String(data.status ?? data.state ?? '').toLowerCase()
      for (const key of ['output', 'result', 'response', 'summary', 'message']) {
        const value = data[key]
        if (typeof value === 'string' && value.trim() && (status.includes('complete') || status.includes('success') || status === 'succeeded')) {
          return value.trim()
        }
      }
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
        return typeof data.error === 'string' ? data.error : 'Agent wake run failed.'
      }
    } catch {
      // retry
    }
  }
  return 'Agent is still working on the project update; check back shortly.'
}

/** Map agentStatus transitions to command-session event types. */
export function commandEventTypeForAgentStatus(
  nextStatus: string | null | undefined,
  previousStatus?: string | null,
): ProjectCommandEventType | null {
  if (!nextStatus || nextStatus === previousStatus) return null
  if (nextStatus === 'picked-up' || nextStatus === 'in-progress') return 'task.started'
  if (nextStatus === 'done') return 'task.done'
  if (nextStatus === 'blocked') return 'task.blocked'
  if (nextStatus === 'awaiting-input') return 'task.awaiting_input'
  if (nextStatus === 'failed') return 'task.failed'
  return null
}

export async function publishTaskLifecycleToCommandSession(input: {
  projectId: string
  orgId: string
  taskId: string
  taskTitle?: string
  agentId?: string | null
  agentStatus: string
  previousAgentStatus?: string | null
  summary?: string
  blockingReason?: string
  requiredEvidence?: string
  messageForAgent?: string
  runId?: string | null
  chatOriginConversationId?: string | null
  projectName?: string
  orgSlug?: string
}): Promise<void> {
  const type = commandEventTypeForAgentStatus(input.agentStatus, input.previousAgentStatus)
  if (!type) return
  const href = taskHrefFor(input.projectId, input.taskId, input.orgSlug)
  await publishProjectCommandEvent({
    projectId: input.projectId,
    projectName: input.projectName,
    orgId: input.orgId,
    taskChatOriginConversationId: input.chatOriginConversationId,
    allowWake: true,
    event: {
      schemaVersion: 1,
      type,
      projectId: input.projectId,
      projectName: input.projectName,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      agentId: input.agentId ?? undefined,
      summary: input.summary,
      blockingReason: input.blockingReason,
      requiredEvidence: input.requiredEvidence,
      messageForAgent: input.messageForAgent,
      runId: input.runId ?? null,
      taskHref: href,
      occurredAt: nowIso(),
      idempotencyKey: `${type}:${input.projectId}:${input.taskId}:${input.agentStatus}:${input.runId || 'norun'}`,
    },
  })
}
