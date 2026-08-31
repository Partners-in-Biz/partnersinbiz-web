import { adminDb } from '@/lib/firebase/admin'
import { serializeAccount } from '@/lib/mailbox/serializers'
import type { MailboxAccountSafe } from '@/lib/mailbox/types'

export async function listMailboxAccountsForUser(orgId: string, uid: string): Promise<MailboxAccountSafe[]> {
  if (!orgId.trim() || !uid.trim()) return []
  const snap = await adminDb.collection('mailbox_accounts').where('orgId', '==', orgId).where('uid', '==', uid).get()
  return snap.docs
    .filter((doc) => !doc.data().deletedAt)
    .map((doc) => serializeAccount(doc.id, doc.data()))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.emailAddress.localeCompare(b.emailAddress))
}

export function buildMailboxContextPromptBlock(input: {
  orgId: string
  uid: string
  accounts: MailboxAccountSafe[]
  mailboxDelegationEvidenceId?: string | null
  conversationId?: string | null
  responseMessageId?: string | null
}): string {
  const connected = input.accounts.filter((account) => account.status === 'connected')
  const lines = [
    '[Mailbox connections — authenticated email for this user]',
    `orgId: ${input.orgId}`,
    `uid: ${input.uid}`,
  ]

  if (input.conversationId) lines.push(`conversationId: ${input.conversationId}`)
  if (input.responseMessageId) lines.push(`responseMessageId: ${input.responseMessageId}`)

  // Hard contract for Messages email side canvas — always injected, even with no mailbox.
  lines.push('EMAIL CANVAS (mandatory when user asks to email / put in an email / draft an email / email preview):')
  lines.push('- NEVER paste a full email as chat-only “preview” text. That does not open the email side canvas.')
  lines.push('- Always create a real draft via POST /api/v1/agent/email/drafts (or /replies for replies) using the injected user-delegation Bearer token.')
  lines.push('- Body JSON must include: orgId, uid (or rely on delegation), to, subject, bodyText.')
  if (input.conversationId && input.responseMessageId) {
    lines.push(`- Also include conversationId=${input.conversationId} and responseMessageId=${input.responseMessageId} so Messages can auto-open the draft canvas.`)
  }
  lines.push('- Echo the returned uiActions + contextRef into the assistant message (structured uiActions/ui_actions, not only prose).')
  lines.push('- Messages treats open_context { kind: "email", id } as attach-and-open for EmailContextComposer. Humans edit there and use Approve & send. Never auto-send.')
  lines.push('- If a mailbox route returns 401/403 with delegation-evidence, the platform remints a fresh user-delegation token once and retries. If it still fails, say the mailbox call failed and stop.')

  if (connected.length === 0) {
    lines.push('status: none')
    lines.push('No connected Gmail/SMTP mailbox for this user yet.')
    lines.push('You can still POST /api/v1/agent/email/drafts for review in the side canvas (send stays disabled until they connect email in Portal → Email).')
    lines.push('Do not invent that a mailbox is connected. Do not claim the canvas opened unless the drafts API succeeded and you echoed open_context / included conversation handoff ids.')
    lines.push('---', '')
    return lines.join('\n')
  }

  lines.push(`status: connected (${connected.length})`)
  for (const account of connected.slice(0, 8)) {
    lines.push(
      `- accountId=${account.id}; provider=${account.provider}; email=${account.emailAddress}; default=${account.isDefault ? 'yes' : 'no'}; lastSyncAt=${account.lastSyncAt ?? 'never'}`,
    )
  }
  lines.push('Before asking the user to paste an email, call the agent mailbox APIs with the injected user-delegation Bearer token from THIS turn:')
  lines.push(`- GET /api/v1/agent/email/accounts?orgId=${encodeURIComponent(input.orgId)}&uid=${encodeURIComponent(input.uid)}`)
  lines.push(`- GET /api/v1/agent/email/messages?orgId=${encodeURIComponent(input.orgId)}&uid=${encodeURIComponent(input.uid)}&summarize=true&q=...`)
  lines.push(`- Then GET /api/v1/agent/email/messages/{id}?orgId=...&uid=... for the full body (summarize includes bodyPreview up to 8k chars — use it; do not ask the user to paste).`)
  lines.push('Reads auto-refresh stale Google sync and run a live Gmail search for `q` (name, address, and/or date). Prefer short queries like `rs@ahslaw.co.za` or `Rikus Stander July 20`.')
  lines.push('If mailbox status is connected and search returns hits, NEVER ask the user to paste email content. If search returns zero, retry once with a shorter q (email address only) before saying you cannot find it.')
  lines.push(`Hard scope: only uid=${input.uid} in orgId=${input.orgId}. Do not query another user's mailbox.`)
  if (input.mailboxDelegationEvidenceId) {
    lines.push(`- Include delegationEvidenceId=${input.mailboxDelegationEvidenceId} only when the caller is already a scoped agent API key. Do not fall back to AI_API_KEY.`)
  }
  lines.push('After drafting via POST /api/v1/agent/email/drafts or /replies, echo the returned uiActions/contextRef so Messages opens the email side canvas. Never auto-send; humans Approve & send.')
  lines.push('---', '')
  return lines.join('\n')
}
