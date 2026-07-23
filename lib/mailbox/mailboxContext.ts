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
}): string {
  const connected = input.accounts.filter((account) => account.status === 'connected')
  const lines = [
    '[Mailbox connections — authenticated email for this user]',
    `orgId: ${input.orgId}`,
    `uid: ${input.uid}`,
  ]

  if (connected.length === 0) {
    lines.push('status: none')
    lines.push('No connected Gmail/SMTP mailbox for this user. Ask them to connect email in Portal → Email, or continue without mailbox reads.')
    lines.push('---', '')
    return lines.join('\n')
  }

  lines.push(`status: connected (${connected.length})`)
  for (const account of connected.slice(0, 8)) {
    lines.push(
      `- accountId=${account.id}; provider=${account.provider}; email=${account.emailAddress}; default=${account.isDefault ? 'yes' : 'no'}; lastSyncAt=${account.lastSyncAt ?? 'never'}`,
    )
  }
  lines.push('Before asking the user to paste an email, call the agent mailbox APIs with the injected user-delegation Bearer token:')
  lines.push(`- GET /api/v1/agent/email/accounts?orgId=${encodeURIComponent(input.orgId)}&uid=${encodeURIComponent(input.uid)}`)
  lines.push(`- GET /api/v1/agent/email/messages?orgId=${encodeURIComponent(input.orgId)}&uid=${encodeURIComponent(input.uid)}&summarize=true&q=...`)
  lines.push('Reads auto-refresh stale Google sync and run a live Gmail search for `q` (name, address, and/or date). Prefer short queries like `rs@ahslaw.co.za` or `Rikus Stander July 20` — do not paste Gmail UI instructions.')
  lines.push(`Hard scope: only uid=${input.uid} in orgId=${input.orgId}. Do not query another user's mailbox.`)
  if (input.mailboxDelegationEvidenceId) {
    lines.push(`- Include delegationEvidenceId=${input.mailboxDelegationEvidenceId} when calling with an agent/system key instead of the user-delegation token.`)
  }
  lines.push('After drafting via POST /api/v1/agent/email/drafts or /replies, echo the returned uiActions/contextRef so Messages opens the email side canvas. Never auto-send; humans Approve & send.')
  lines.push('---', '')
  return lines.join('\n')
}
