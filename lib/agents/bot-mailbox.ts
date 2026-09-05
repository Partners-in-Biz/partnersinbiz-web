import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { callAgentPath } from '@/lib/agents/team'
import type { AgentId, BotMailboxRecord } from '@/lib/agents/types'

/**
 * Hermes Mail Agent contract (see docs/specs/bot-mode-v1-pin-avatar-mail.md).
 * The agent's own Hermes runtime owns the inbox; PiB only stores the address.
 */
export const HERMES_MAIL_INBOX_PATH = '/api/mail/inbox'

export const HERMES_MAIL_AGENT_NEED =
  '[NEED] Hermes Mail Agent is not installed on this Bot\'s runtime. Install the mail agent (AgentMail-backed) on the VPS / linked computer and expose POST /api/mail/inbox; then provision again.'

export type ProvisionBotMailboxResult =
  | { ok: true; mailbox: BotMailboxRecord }
  | { ok: false; status: 502 | 503; error: string }

type HermesInboxResponse = {
  address?: unknown
  email?: unknown
  inboxId?: unknown
  inbox_id?: unknown
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Accept `{ address }` or `{ email }` / `{ inbox_id }` variants; anything else is not an inbox. */
export function parseHermesInboxResponse(data: unknown): { address: string; inboxId: string | null } | null {
  if (!data || typeof data !== 'object') return null
  const body = (data as { data?: unknown }).data && typeof (data as { data?: unknown }).data === 'object'
    ? (data as { data: HermesInboxResponse }).data
    : data as HermesInboxResponse
  const addressRaw = typeof body.address === 'string' ? body.address : typeof body.email === 'string' ? body.email : ''
  const address = addressRaw.trim().toLowerCase()
  if (!EMAIL_RE.test(address)) return null
  const inboxIdRaw = typeof body.inboxId === 'string' ? body.inboxId : typeof body.inbox_id === 'string' ? body.inbox_id : null
  return { address, inboxId: inboxIdRaw?.trim() || null }
}

export async function provisionBotMailbox(input: {
  agentId: AgentId
  displayName: string
}): Promise<ProvisionBotMailboxResult> {
  let response: Response
  let data: unknown
  try {
    ;({ response, data } = await callAgentPath(input.agentId, HERMES_MAIL_INBOX_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: input.agentId, displayName: input.displayName }),
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hermes runtime unreachable'
    return { ok: false, status: 503, error: `${HERMES_MAIL_AGENT_NEED} (${message})` }
  }

  if (response.status === 404 || response.status === 501) {
    return { ok: false, status: 503, error: HERMES_MAIL_AGENT_NEED }
  }
  if (!response.ok) {
    const detail = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
      ? (data as { error: string }).error
      : `Hermes Mail Agent returned ${response.status}`
    return { ok: false, status: 502, error: detail }
  }

  const parsed = parseHermesInboxResponse(data)
  if (!parsed) {
    return { ok: false, status: 502, error: 'Hermes Mail Agent did not return an inbox address' }
  }

  const mailbox: BotMailboxRecord = {
    provider: 'hermes-mail-agent',
    address: parsed.address,
    inboxId: parsed.inboxId,
    status: 'active',
    error: null,
    updatedAt: new Date().toISOString(),
  }
  await adminDb.collection('agent_team').doc(input.agentId).set({
    mailbox,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true, mailbox }
}
