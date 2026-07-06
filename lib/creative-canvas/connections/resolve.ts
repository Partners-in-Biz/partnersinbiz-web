/**
 * Single choke point that picks WHICH credential a run uses.
 * Precedence (approved 2026-07-05): user-scoped key → org-scoped key →
 * shared platform runtime (higgsfield always; xai only when XAI_API_KEY env
 * exists) → connection_required.
 */
import type { CreativeCanvasProviderKey } from '../types'
import { creativeProviderConnectionId, type CreativeProviderConnection } from './types'
import { decryptConnectionCredentials, type ConnectionCredentials } from './crypto'
import { getCreativeProviderConnection, markConnectionUsed } from './store'

export type ResolvedCredential =
  | { kind: 'byok'; connection: CreativeProviderConnection; credentials: ConnectionCredentials }
  | { kind: 'shared' }
  | { kind: 'connection_required' }

function usable(conn: CreativeProviderConnection | null): conn is CreativeProviderConnection {
  return Boolean(conn && conn.status === 'connected' && conn.credentialsEnc)
}

export async function resolveCreativeProviderCredential(input: {
  provider: CreativeCanvasProviderKey
  orgId: string
  uid: string
}): Promise<ResolvedCredential> {
  const candidates: string[] = []
  if (input.uid) {
    candidates.push(creativeProviderConnectionId({ provider: input.provider, scope: 'user', orgId: input.orgId, ownerUid: input.uid }))
  }
  candidates.push(creativeProviderConnectionId({ provider: input.provider, scope: 'org', orgId: input.orgId, ownerUid: null }))

  for (const id of candidates) {
    const conn = await getCreativeProviderConnection(id)
    if (!usable(conn)) continue
    try {
      const credentials = decryptConnectionCredentials(conn.credentialsEnc!, conn.scopeKeyRef)
      void markConnectionUsed(conn.id)
      return { kind: 'byok', connection: conn, credentials }
    } catch {
      // Wrong/rotated master key — unusable; fall through to the next candidate.
      continue
    }
  }
  if (input.provider === 'higgsfield') return { kind: 'shared' }
  // xai keeps its platform env-key fallback (existing social/canvas behaviour) —
  // that path charges platform credits; the caller decides billing off `kind`.
  if (input.provider === 'xai' && process.env.XAI_API_KEY?.trim()) return { kind: 'shared' }
  return { kind: 'connection_required' }
}
