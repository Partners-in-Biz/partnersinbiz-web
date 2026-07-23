import { adminDb } from '@/lib/firebase/admin'
import { toIso } from '@/lib/mailbox/serializers'
import { syncGmailMailboxAccount, syncGmailMailboxSearch } from '@/lib/mailbox/gmailSync'
import { buildGmailSearchQuery } from '@/lib/mailbox/messageSearch'

const STALE_MS = 5 * 60 * 1000

export function isMailboxSyncStale(lastSyncAt: string | null): boolean {
  if (!lastSyncAt) return true
  const lastSyncMs = new Date(lastSyncAt).getTime()
  return !Number.isFinite(lastSyncMs) || Date.now() - lastSyncMs > STALE_MS
}

export type MailboxFreshnessResult = {
  attempted: number
  failed: number
  searched: number
}

async function listConnectedGoogleAccounts(orgId: string, uid: string, accountId?: string | null) {
  const snap = await adminDb.collection('mailbox_accounts').where('orgId', '==', orgId).where('uid', '==', uid).get()
  return snap.docs
    .filter((doc) => !doc.data().deletedAt)
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter(({ data }) => data.provider === 'google' && data.status === 'connected' && data.googleEnc)
    .filter(({ id }) => !accountId || accountId === 'all' || id === accountId)
}

/** Refresh stale Google mailboxes (portal + agent). Optional live Gmail `q` import. */
export async function ensureFreshGoogleMailboxData(
  orgId: string,
  uid: string,
  accountId: string | null = null,
  options: { forceRefresh?: boolean; q?: string } = {},
): Promise<MailboxFreshnessResult> {
  const forceRefresh = options.forceRefresh === true
  const accounts = (await listConnectedGoogleAccounts(orgId, uid, accountId)).slice(0, 3)

  const staleOrForced = accounts.filter(({ data }) => forceRefresh || isMailboxSyncStale(toIso(data.lastSyncAt)))
  const syncResults = await Promise.all(staleOrForced.map(({ id }) => syncGmailMailboxAccount({
    orgId,
    uid,
    accountId: id,
    mode: 'incremental',
    maxResults: forceRefresh ? 160 : 80,
  }).catch((error) => ({ ok: false as const, error: error instanceof Error ? error.message : 'Mailbox sync failed' }))))

  const gmailQ = buildGmailSearchQuery(options.q ?? '')
  let searched = 0
  if (gmailQ) {
    const searchResults = await Promise.all(accounts.map(({ id }) => {
      searched += 1
      return syncGmailMailboxSearch({
        orgId,
        uid,
        accountId: id,
        q: gmailQ,
        maxResults: 40,
      }).catch((error) => ({ ok: false as const, error: error instanceof Error ? error.message : 'Mailbox search sync failed' }))
    }))
    const failed = [...syncResults, ...searchResults].filter((result) => !result.ok).length
    return { attempted: staleOrForced.length, failed, searched }
  }

  return {
    attempted: staleOrForced.length,
    failed: syncResults.filter((result) => !result.ok).length,
    searched: 0,
  }
}
