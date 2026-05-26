import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { serializeAccount, serializeMessage, splitEmails } from '@/lib/mailbox/serializers'
import type { MailboxFolder, MailboxMessageSafe } from '@/lib/mailbox/types'
import { sendMailboxMessage, type SendMailboxMessageResult } from '@/lib/mailbox/sendBridge'
import type { AgentMailboxDelegationEvidence } from '@/lib/mailbox/agentEmailAuthorization'

type ActorType = 'user' | 'agent' | 'system'

export type AgentMailboxActor = {
  actorId: string
  actorType: ActorType
}

export type AgentMailboxContext = {
  orgId: string
  uid: string
  delegation?: AgentMailboxDelegationEvidence
}

export type AgentMailboxReadInput = AgentMailboxContext & {
  folder?: MailboxFolder | 'all'
  accountId?: string
  q?: string
  limit?: number
}

export type AgentMailboxDraftInput = AgentMailboxContext & {
  accountId?: string
  to?: unknown
  cc?: unknown
  bcc?: unknown
  subject?: string
  bodyText?: string
  bodyHtml?: string
}

export type AgentMailboxReplyDraftInput = AgentMailboxContext & {
  accountId?: string
  sourceMessageId: string
  bodyText: string
  bodyHtml?: string
}

export type AgentMailboxApprovalEvidence = {
  approvalGateTaskId?: string
  approvalTaskId?: string
  approvedBy?: string
  approvedAt?: string
  approvalCommentId?: string
  evidenceUrl?: string
  reason?: string
}

export type AgentMailboxSendRequestInput = AgentMailboxContext & {
  accountId: string
  to?: unknown
  cc?: unknown
  bcc?: unknown
  subject?: string
  bodyText?: string
  bodyHtml?: string
  dryRun?: boolean
  approvalEvidence?: AgentMailboxApprovalEvidence
}

type AgentMailboxSummaryItem = Pick<MailboxMessageSafe, 'id' | 'from' | 'to' | 'subject' | 'snippet' | 'createdAt' | 'receivedAt' | 'sentAt' | 'folder'>

function requireContext(input: AgentMailboxContext) {
  if (!input.orgId?.trim()) throw new Error('orgId is required')
  if (!input.uid?.trim()) throw new Error('uid is required')
}

function cleanLimit(limit: unknown, fallback = 25): number {
  const parsed = Number(limit ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), 1), 100)
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function snippet(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 180)
}

function isApprovalEvidence(value: unknown): value is AgentMailboxApprovalEvidence {
  if (!value || typeof value !== 'object') return false
  const evidence = value as AgentMailboxApprovalEvidence
  return Boolean(
    normalizeText(evidence.approvalGateTaskId) ||
    normalizeText(evidence.approvalTaskId) ||
    normalizeText(evidence.approvalCommentId) ||
    normalizeText(evidence.evidenceUrl),
  )
}

async function writeToolEvent(input: AgentMailboxContext, actor: AgentMailboxActor, patch: Record<string, unknown>) {
  await adminDb.collection('mailbox_agent_tool_events').add({
    orgId: input.orgId,
    uid: input.uid,
    delegatedUid: input.uid,
    actor: { id: actor.actorId, type: actor.actorType },
    delegationEvidence: input.delegation ? {
      id: input.delegation.evidenceId,
      type: input.delegation.evidenceType,
      actionClass: input.delegation.actionClass,
    } : null,
    createdAt: FieldValue.serverTimestamp(),
    ...patch,
  })
}

async function loadDefaultAccount(input: AgentMailboxContext) {
  const snap = await adminDb.collection('mailbox_accounts').where('orgId', '==', input.orgId).where('uid', '==', input.uid).get()
  const accounts = snap.docs
    .filter((doc) => !doc.data().deletedAt)
    .map((doc) => serializeAccount(doc.id, doc.data()))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.emailAddress.localeCompare(b.emailAddress))
  return accounts[0] ?? null
}

async function loadMessage(input: AgentMailboxContext & { messageId: string }) {
  const doc = await adminDb.collection('mailbox_messages').doc(input.messageId).get()
  if (!doc.exists) return null
  const data = doc.data() ?? {}
  if (data.orgId !== input.orgId || data.uid !== input.uid) return null
  return serializeMessage(doc.id, data)
}

async function resolveAccount(input: AgentMailboxContext & { accountId?: string }) {
  if (!input.accountId) return loadDefaultAccount(input)
  const doc = await adminDb.collection('mailbox_accounts').doc(input.accountId).get()
  if (!doc.exists) return null
  const data = doc.data() ?? {}
  if (data.orgId !== input.orgId || data.uid !== input.uid || data.deletedAt) return null
  return serializeAccount(doc.id, data)
}

export async function readAgentMailboxMessages(input: AgentMailboxReadInput, actor: AgentMailboxActor) {
  requireContext(input)
  const limit = cleanLimit(input.limit)
  const folder = input.folder ?? 'inbox'
  const queryText = normalizeText(input.q).toLowerCase()
  let query = adminDb.collection('mailbox_messages').where('orgId', '==', input.orgId).where('uid', '==', input.uid) as FirebaseFirestore.Query
  if (input.accountId && input.accountId !== 'all') query = query.where('accountId', '==', input.accountId)
  const snap = await query.get()
  let messages = snap.docs.map((doc) => serializeMessage(doc.id, doc.data()))
  if (folder !== 'all') messages = messages.filter((message) => message.folder === folder)
  if (queryText) {
    messages = messages.filter((message) =>
      [message.subject, message.from, message.accountEmail, message.snippet, ...message.to, ...message.cc]
        .some((value) => value.toLowerCase().includes(queryText)),
    )
  }
  messages.sort((a, b) => new Date(b.createdAt ?? b.receivedAt ?? b.sentAt ?? 0).getTime() - new Date(a.createdAt ?? a.receivedAt ?? a.sentAt ?? 0).getTime())
  const scoped = messages.slice(0, limit)
  await writeToolEvent(input, actor, { action: 'read_context', folder, accountId: input.accountId ?? null, q: queryText || null, resultCount: scoped.length })
  return { context: { orgId: input.orgId, uid: input.uid, folder, accountId: input.accountId ?? null }, messages: scoped }
}

export async function summarizeAgentMailboxContext(input: AgentMailboxReadInput, actor: AgentMailboxActor) {
  const result = await readAgentMailboxMessages(input, actor)
  const items: AgentMailboxSummaryItem[] = result.messages.map((message) => ({
    id: message.id,
    folder: message.folder,
    from: message.from,
    to: message.to,
    subject: message.subject,
    snippet: message.snippet,
    createdAt: message.createdAt,
    receivedAt: message.receivedAt,
    sentAt: message.sentAt,
  }))
  const summary = items.length === 0
    ? 'No matching mailbox messages found for the requested user/org context.'
    : items.map((item, index) => `${index + 1}. ${item.subject || '(no subject)'} — ${item.from} — ${item.snippet}`).join('\n')
  await writeToolEvent(input, actor, { action: 'summarize_context', resultCount: items.length })
  return { context: result.context, summary, items }
}

export async function createAgentMailboxDraft(input: AgentMailboxDraftInput, actor: AgentMailboxActor) {
  requireContext(input)
  const account = await resolveAccount(input)
  if (!account) throw new Error('Mailbox account not found for requested user/org context')
  const subject = normalizeText(input.subject)
  const bodyText = normalizeText(input.bodyText)
  const bodyHtml = typeof input.bodyHtml === 'string' ? input.bodyHtml : undefined
  if (!subject && !bodyText) throw new Error('Subject or body is required')
  const now = FieldValue.serverTimestamp()
  const payload: Record<string, unknown> = {
    orgId: input.orgId,
    uid: input.uid,
    profileId: `${input.orgId}_${input.uid}`,
    accountId: account.id,
    accountEmail: account.emailAddress,
    folder: 'drafts',
    direction: 'draft',
    status: 'draft',
    read: true,
    starred: false,
    from: account.emailAddress,
    to: splitEmails(input.to),
    cc: splitEmails(input.cc),
    bcc: splitEmails(input.bcc),
    subject,
    bodyText,
    ...(bodyHtml ? { bodyHtml } : {}),
    snippet: snippet(bodyText),
    createdBy: { id: actor.actorId, type: actor.actorType },
    createdAt: now,
    updatedAt: now,
  }
  const ref = await adminDb.collection('mailbox_messages').add(payload)
  await writeToolEvent(input, actor, { action: 'draft_created', mailboxMessageId: ref.id, accountId: account.id })
  const fresh = await ref.get()
  return { message: serializeMessage(ref.id, fresh.data() ?? payload) }
}

export async function createAgentMailboxReplyDraft(input: AgentMailboxReplyDraftInput, actor: AgentMailboxActor) {
  requireContext(input)
  const source = await loadMessage({ orgId: input.orgId, uid: input.uid, messageId: input.sourceMessageId })
  if (!source) throw new Error('Source mailbox message not found for requested user/org context')
  const accountId = input.accountId ?? source.accountId
  const subject = source.subject.toLowerCase().startsWith('re:') ? source.subject : `Re: ${source.subject}`
  const to = source.direction === 'outbound' ? source.to : [source.from].filter(Boolean)
  const draft = await createAgentMailboxDraft({
    orgId: input.orgId,
    uid: input.uid,
    accountId,
    to,
    subject,
    bodyText: input.bodyText,
    ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
  }, actor)
  await adminDb.collection('mailbox_messages').doc(draft.message.id).get().then(async () => {
    // The draft payload is intentionally independent, but the audit trail ties it to the source.
    await writeToolEvent(input, actor, { action: 'reply_draft_created', mailboxMessageId: draft.message.id, sourceMessageId: source.id, accountId })
  })
  return draft
}

export async function requestAgentMailboxSend(input: AgentMailboxSendRequestInput, actor: AgentMailboxActor): Promise<{ requestId: string; sendResult: SendMailboxMessageResult }> {
  requireContext(input)
  if (!isApprovalEvidence(input.approvalEvidence)) {
    await writeToolEvent(input, actor, { action: 'send_request_rejected', reason: 'missing_approval_evidence', accountId: input.accountId ?? null, recipientCount: splitEmails(input.to).length })
    throw new Error('Agent mailbox send requires approval evidence')
  }
  const to = splitEmails(input.to)
  const subject = normalizeText(input.subject)
  const bodyText = normalizeText(input.bodyText)
  if (to.length === 0) throw new Error('At least one recipient is required')
  if (!subject && !bodyText) throw new Error('Subject or body is required')
  const now = FieldValue.serverTimestamp()
  const requestPayload: Record<string, unknown> = {
    orgId: input.orgId,
    uid: input.uid,
    accountId: input.accountId,
    actor: { id: actor.actorId, type: actor.actorType },
    to,
    cc: splitEmails(input.cc),
    bcc: splitEmails(input.bcc),
    subject,
    bodyText,
    ...(typeof input.bodyHtml === 'string' ? { bodyHtml: input.bodyHtml } : {}),
    dryRun: input.dryRun === true,
    approvalEvidence: input.approvalEvidence,
    status: 'requested',
    createdAt: now,
    updatedAt: now,
  }
  const ref = await adminDb.collection('mailbox_send_requests').add(requestPayload)
  const sendResult = await sendMailboxMessage({
    orgId: input.orgId,
    uid: input.uid,
    accountId: input.accountId,
    approved: true,
    dryRun: input.dryRun === true,
    to,
    cc: splitEmails(input.cc),
    bcc: splitEmails(input.bcc),
    subject,
    bodyText,
    ...(typeof input.bodyHtml === 'string' ? { bodyHtml: input.bodyHtml } : {}),
    actorId: actor.actorId,
    actorType: actor.actorType,
    approvalGateTaskId: input.approvalEvidence.approvalGateTaskId ?? input.approvalEvidence.approvalTaskId,
  })
  requestPayload.status = sendResult.ok ? (sendResult.dryRun ? 'dry_run' : 'sent') : 'failed'
  requestPayload.sendResult = sendResult
  requestPayload.updatedAt = now
  await ref.update({ status: requestPayload.status, sendResult, updatedAt: now })
  await writeToolEvent(input, actor, { action: 'send_request_accepted', requestId: ref.id, accountId: input.accountId, recipientCount: to.length, status: requestPayload.status })
  return { requestId: ref.id, sendResult }
}
