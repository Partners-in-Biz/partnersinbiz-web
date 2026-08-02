import { adminDb } from '@/lib/firebase/admin'
import { getDecryptedLlmCredentials } from './store'
import { xaiCredentialsNeedRefresh } from './refresh'
import { syncLlmConnectionToHermes } from './sync-hermes'
import { LLM_PROVIDER_CONNECTIONS_COLLECTION, type LlmProviderConnection } from './types'

export type LlmCredentialRefreshSummary = {
  scanned: number
  due: number
  refreshed: number
  synced: number
  queued: number
  failed: number
}

/**
 * Refresh due xAI OAuth accounts centrally and deliver the resulting access
 * token to their eligible Hermes profiles. Refresh tokens never leave the web
 * control plane: delivery is access-only and every target is re-verified by
 * the normal credential sync path.
 */
export async function refreshDueXaiLlmConnections(input: {
  limit?: number
  nowMs?: number
} = {}): Promise<LlmCredentialRefreshSummary> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 16), 1), 50)
  const snapshot = await adminDb
    .collection(LLM_PROVIDER_CONNECTIONS_COLLECTION)
    .where('provider', '==', 'xai-oauth')
    .limit(limit)
    .get()

  const summary: LlmCredentialRefreshSummary = {
    scanned: 0,
    due: 0,
    refreshed: 0,
    synced: 0,
    queued: 0,
    failed: 0,
  }

  for (const doc of snapshot.docs) {
    const connection = { ...(doc.data() as LlmProviderConnection), id: doc.id }
    if (!['connected', 'invalid'].includes(connection.status) || !connection.credentialsEnc) continue
    summary.scanned += 1

    try {
      const credentials = await getDecryptedLlmCredentials(connection)
      if (!credentials?.access_token || !xaiCredentialsNeedRefresh(credentials, input.nowMs)) continue
      summary.due += 1

      const sync = await syncLlmConnectionToHermes(connection.id)
      summary.refreshed += 1
      summary.synced += sync.synced.length
      summary.queued += sync.queued.length
      if (sync.failed.length) summary.failed += 1
    } catch {
      // The refresh broker records `reauth_required` or retryable `invalid`
      // state on the connection. One account must not block the rest of fleet.
      summary.failed += 1
    }
  }

  return summary
}
