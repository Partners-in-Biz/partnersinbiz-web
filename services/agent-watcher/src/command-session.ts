/**
 * Project command session feed from the agent-watcher.
 * Standalone Firestore writes (watcher cannot import the Next.js lib tree).
 */
import type { DocumentReference } from 'firebase-admin/firestore'
import { db, FieldValue } from './firestore'
import { logger } from './logger'
import { runAndPoll, type TaskDispatchInput } from './hermes'
import { getAgentConfig, type AgentId } from './config'

export type CommandEventType =
  | 'task.started'
  | 'task.done'
  | 'task.blocked'
  | 'task.awaiting_input'
  | 'task.failed'

interface CommandSessionBinding {
  conversationId: string
  orgId: string
  enabled: boolean
  autoWake: boolean
  autoWakeAgentId: string
  autoWakeOn: string[]
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeBinding(value: unknown): CommandSessionBinding | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const conversationId = clean(raw.conversationId)
  const orgId = clean(raw.orgId)
  if (!conversationId || !orgId) return null
  const autoWakeOn = Array.isArray(raw.autoWakeOn)
    ? raw.autoWakeOn.filter((item): item is string => typeof item === 'string')
    : ['blocked', 'awaiting_input']
  return {
    conversationId,
    orgId,
    enabled: raw.enabled !== false,
    autoWake: raw.autoWake !== false,
    autoWakeAgentId: clean(raw.autoWakeAgentId) || 'pip',
    autoWakeOn,
  }
}

function eventTypeForStatus(status: string): CommandEventType | null {
  if (status === 'picked-up' || status === 'in-progress') return 'task.started'
  if (status === 'done') return 'task.done'
  if (status === 'blocked') return 'task.blocked'
  if (status === 'awaiting-input') return 'task.awaiting_input'
  if (status === 'failed') return 'task.failed'
  return null
}

function formatContent(input: {
  type: CommandEventType
  taskTitle: string
  agentId?: string
  summary?: string
  blockingReason?: string
  requiredEvidence?: string
  messageForAgent?: string
  taskHref?: string
}): string {
  const agent = input.agentId ? ` · ${input.agentId}` : ''
  const title = input.taskTitle
  if (input.type === 'task.started') {
    return `**Project update · Started**${agent}\n\n${title}${input.summary ? `\n\n${input.summary}` : ''}${input.taskHref ? `\n\n[Open task](${input.taskHref})` : ''}`
  }
  if (input.type === 'task.done') {
    return `**Project update · Done**${agent}\n\n${title}${input.summary ? `\n\n${input.summary}` : ''}${input.taskHref ? `\n\n[Open task](${input.taskHref})` : ''}`
  }
  if (input.type === 'task.blocked') {
    return `**Project update · Blocked**${agent}\n\n${title}\n\n**Blocker:** ${input.blockingReason || input.summary || 'Unknown'}${input.requiredEvidence ? `\n\n**Proof needed:** ${input.requiredEvidence}` : ''}${input.messageForAgent ? `\n\n**Agent note:** ${input.messageForAgent}` : ''}${input.taskHref ? `\n\n[Open task](${input.taskHref})` : ''}`
  }
  if (input.type === 'task.awaiting_input') {
    return `**Project update · Needs you**${agent}\n\n${title}\n\n**What is needed:** ${input.blockingReason || input.summary || 'Human input'}${input.requiredEvidence ? `\n\n**Proof needed:** ${input.requiredEvidence}` : ''}${input.messageForAgent ? `\n\n**Message for agent when resolved:** ${input.messageForAgent}` : ''}${input.taskHref ? `\n\n[Open task](${input.taskHref})` : ''}`
  }
  return `**Project update · Failed**${agent}\n\n${title}${input.summary ? `\n\n${input.summary}` : ''}${input.taskHref ? `\n\n[Open task](${input.taskHref})` : ''}`
}

async function claimIdempotency(projectId: string, key: string): Promise<boolean> {
  const ref = db.collection('projects').doc(projectId).collection('commandSessionEvents').doc(key.slice(0, 700))
  try {
    await ref.create({ idempotencyKey: key, createdAt: FieldValue.serverTimestamp() })
    return true
  } catch {
    return false
  }
}

export async function publishWatcherTaskLifecycle(input: {
  projectId?: string | null
  orgId?: string | null
  taskId: string
  taskTitle?: string
  agentId?: string
  agentStatus: string
  summary?: string
  blockingReason?: string
  requiredEvidence?: string
  messageForAgent?: string
  runId?: string | null
  chatOriginConversationId?: string | null
}): Promise<void> {
  const projectId = clean(input.projectId)
  const orgId = clean(input.orgId)
  if (!projectId || !orgId) return
  const type = eventTypeForStatus(input.agentStatus)
  if (!type) return

  try {
    const projectSnap = await db.collection('projects').doc(projectId).get()
    const binding = normalizeBinding(projectSnap.data()?.commandSession)
    const conversationId = (binding?.enabled && binding.conversationId)
      || clean(input.chatOriginConversationId)
    if (!conversationId) return

    const idempotencyKey = `${type}:${projectId}:${input.taskId}:${input.agentStatus}:${input.runId || 'norun'}`
    if (!(await claimIdempotency(projectId, idempotencyKey))) return

    const projectName = clean(projectSnap.data()?.name) || projectId
    const taskHref = `/portal/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(input.taskId)}`
    const event = {
      schemaVersion: 1 as const,
      type,
      projectId,
      projectName,
      taskId: input.taskId,
      taskTitle: input.taskTitle || input.taskId,
      agentId: input.agentId,
      summary: input.summary,
      blockingReason: input.blockingReason,
      requiredEvidence: input.requiredEvidence,
      messageForAgent: input.messageForAgent,
      runId: input.runId ?? null,
      taskHref,
      occurredAt: nowIso(),
      idempotencyKey,
    }
    const content = formatContent({
      type,
      taskTitle: event.taskTitle || input.taskId,
      agentId: input.agentId,
      summary: input.summary,
      blockingReason: input.blockingReason,
      requiredEvidence: input.requiredEvidence,
      messageForAgent: input.messageForAgent,
      taskHref,
    })

    const msgRef = db.collection('conversations').doc(conversationId).collection('messages').doc()
    await msgRef.set({
      conversationId,
      role: 'system',
      content,
      status: 'completed',
      authorKind: 'system',
      authorId: 'system:project-command',
      authorDisplayName: 'Project command',
      richParts: [{ type: 'project_command_event', event }],
      createdAt: FieldValue.serverTimestamp(),
    })
    await db.collection('conversations').doc(conversationId).update({
      lastMessagePreview: content.replace(/\s+/g, ' ').slice(0, 200),
      lastMessageRole: 'system',
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageId: msgRef.id,
      messageCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    })

    const autoWakeOn = binding?.autoWakeOn ?? ['blocked', 'awaiting_input']
    const wakeKey = type === 'task.blocked'
      ? 'blocked'
      : type === 'task.awaiting_input'
        ? 'awaiting_input'
        : type === 'task.done'
          ? 'done'
          : type === 'task.started'
            ? 'started'
            : type === 'task.failed'
              ? 'failed'
              : ''
    const shouldWake = Boolean(binding?.enabled && binding.autoWake && wakeKey && autoWakeOn.includes(wakeKey))
    if (shouldWake) {
      await wakeLeadAgent({
        conversationId,
        orgId,
        projectId,
        projectName,
        agentId: (binding?.autoWakeAgentId || 'pip') as AgentId,
        event,
        content,
      }).catch((error) => {
        logger.warn('command-session auto-wake failed', {
          projectId,
          taskId: input.taskId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  } catch (error) {
    logger.warn('command-session publish failed', {
      projectId,
      taskId: input.taskId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function wakeLeadAgent(input: {
  conversationId: string
  orgId: string
  projectId: string
  projectName: string
  agentId: AgentId
  event: Record<string, unknown>
  content: string
}): Promise<void> {
  const cfg = await getAgentConfig(input.agentId)
  if (!cfg?.enabled) return

  const historySnap = await db.collection('conversations').doc(input.conversationId)
    .collection('messages')
    .orderBy('createdAt', 'desc')
    .limit(12)
    .get()
  const transcript = historySnap.docs.reverse().map((doc) => {
    const data = doc.data()
    const who = data.authorDisplayName || data.authorId || data.role
    const body = String(data.content || '').replace(/\s+/g, ' ').trim().slice(0, 500)
    return `${who}: ${body}`
  }).join('\n')

  const pendingRef = db.collection('conversations').doc(input.conversationId).collection('messages').doc()
  await pendingRef.set({
    conversationId: input.conversationId,
    role: 'assistant',
    content: '',
    status: 'pending',
    authorKind: 'agent',
    authorId: input.agentId,
    authorDisplayName: input.agentId,
    dispatchAgentId: input.agentId,
    createdAt: FieldValue.serverTimestamp(),
  })

  const prompt = [
    'You are the project command agent for Partners in Biz.',
    `Project: ${input.projectName} (${input.projectId})`,
    `Command conversation: ${input.conversationId}`,
    '',
    'A Kanban task lifecycle event just arrived in this command session.',
    input.content,
    '',
    'Recent command-chat transcript:',
    transcript || '(empty)',
    '',
    'Use prior chat instructions if they resolve the issue. Act safely via platform APIs when possible.',
    'If you need human input, ask once and clearly. Never bypass production/deploy, spend, publish, finance, client-send, secret, or destructive gates.',
    'Keep the reply concise.',
  ].join('\n')

  const dispatchInput: TaskDispatchInput = {
    taskId: `command-wake-${input.projectId}-${String(input.event.taskId || 'task')}`,
    orgId: input.orgId,
    agentId: input.agentId,
    spec: prompt,
    context: {
      projectId: input.projectId,
      conversationId: input.conversationId,
      source: 'project-command-session',
    },
  }

  const result = await runAndPoll(cfg, dispatchInput)
  const finalContent = (result.output || result.error || 'I reviewed the project update.').slice(0, 8_000)
  await pendingRef.update({
    content: finalContent,
    status: result.error ? 'failed' : 'completed',
    ...(result.error ? { error: result.error } : {}),
    ...(result.runId ? { runId: result.runId } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await db.collection('conversations').doc(input.conversationId).update({
    lastMessagePreview: finalContent.replace(/\s+/g, ' ').slice(0, 200),
    lastMessageRole: 'assistant',
    lastMessageAt: FieldValue.serverTimestamp(),
    lastMessageId: pendingRef.id,
    messageCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

/** Fire-and-forget helper after task status writes in the watcher. */
export function notifyCommandSessionFromTask(
  taskRef: DocumentReference,
  taskData: Record<string, unknown>,
  agentStatus: string,
  extras: {
    agentId?: string
    summary?: string
    blockingReason?: string
    requiredEvidence?: string
    messageForAgent?: string
    runId?: string | null
  } = {},
): void {
  const chatOrigin = taskData.chatOrigin && typeof taskData.chatOrigin === 'object'
    ? taskData.chatOrigin as Record<string, unknown>
    : null
  void publishWatcherTaskLifecycle({
    projectId: typeof taskData.projectId === 'string' ? taskData.projectId : null,
    orgId: typeof taskData.orgId === 'string' ? taskData.orgId : null,
    taskId: taskRef.id,
    taskTitle: typeof taskData.title === 'string' ? taskData.title : taskRef.id,
    agentId: extras.agentId,
    agentStatus,
    summary: extras.summary,
    blockingReason: extras.blockingReason,
    requiredEvidence: extras.requiredEvidence,
    messageForAgent: extras.messageForAgent,
    runId: extras.runId ?? null,
    chatOriginConversationId: typeof chatOrigin?.conversationId === 'string' ? chatOrigin.conversationId : null,
  })
}
