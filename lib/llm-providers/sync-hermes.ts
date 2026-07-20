/**
 * Push org/user LLM credentials onto Hermes agent runtimes.
 * API keys → /admin/env. OAuth tokens → /admin/auth/providers/{provider}.
 */
import { callAgentPath, listAgents } from '@/lib/agents/team'
import type { AgentId } from '@/lib/agents/types'
import { getLlmProvider } from './providers'
import {
  getDecryptedLlmCredentials,
  getLlmProviderConnection,
  markLlmConnectionError,
  markLlmConnectionSynced,
} from './store'
import type { LlmProviderConnection } from './types'

async function resolveSyncAgentIds(preferred?: string[]): Promise<AgentId[]> {
  if (preferred?.length) {
    return preferred.filter(Boolean) as AgentId[]
  }
  const agents = await listAgents()
  return agents
    .filter((agent) => agent.enabled !== false)
    .map((agent) => agent.agentId as AgentId)
    .slice(0, 24)
}

export async function syncLlmConnectionToHermes(
  connectionId: string,
  options: { agentIds?: string[] } = {},
): Promise<{ synced: string[]; failed: Array<{ agentId: string; error: string }> }> {
  const conn = await getLlmProviderConnection(connectionId)
  if (!conn || conn.status === 'revoked') {
    throw new Error('Connection not found')
  }
  const credentials = await getDecryptedLlmCredentials(conn)
  if (!credentials) {
    throw new Error('Connection has no credentials')
  }

  const def = getLlmProvider(conn.provider)
  const agentIds = await resolveSyncAgentIds(options.agentIds)
  const synced: string[] = []
  const failed: Array<{ agentId: string; error: string }> = []

  for (const agentId of agentIds) {
    try {
      if (credentials.access_token && credentials.refresh_token) {
        await pushOauthTokens(agentId, conn, credentials)
      } else if (def?.envVar && credentials.apiKey) {
        await pushApiKeyEnv(agentId, def.envVar, credentials.apiKey)
      } else if (conn.provider === 'copilot' && credentials.apiKey) {
        await pushApiKeyEnv(agentId, 'COPILOT_GITHUB_TOKEN', credentials.apiKey)
      } else {
        throw new Error('No syncable credential material')
      }
      synced.push(agentId)
    } catch (err) {
      failed.push({
        agentId,
        error: err instanceof Error ? err.message : 'Sync failed',
      })
    }
  }

  if (synced.length) {
    await markLlmConnectionSynced(connectionId, synced)
  } else if (failed.length) {
    await markLlmConnectionError(connectionId, failed[0].error)
  }

  return { synced, failed }
}

async function pushApiKeyEnv(agentId: AgentId, envVar: string, apiKey: string): Promise<void> {
  const { response, data } = await callAgentPath(agentId, '/admin/env', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set: { [envVar]: apiKey }, unset: [] }),
  })
  if (!response.ok) {
    const detail = typeof data === 'object' && data && 'detail' in data
      ? String((data as { detail: unknown }).detail)
      : `HTTP ${response.status}`
    throw new Error(detail)
  }
}

async function pushOauthTokens(
  agentId: AgentId,
  conn: LlmProviderConnection,
  credentials: Record<string, string>,
): Promise<void> {
  const provider = conn.hermesProvider
  const body = {
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
    expires_in: credentials.expires_in ? Number(credentials.expires_in) : undefined,
    token_type: credentials.token_type || 'Bearer',
    ...(credentials.id_token ? { id_token: credentials.id_token } : {}),
    ...(credentials.scope ? { scope: credentials.scope } : {}),
  }
  const { response, data } = await callAgentPath(agentId, `/admin/auth/providers/${provider}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status === 404) {
    // Sidecar without auth endpoint yet — fall back is not possible for OAuth.
    throw new Error(
      'Hermes runtime does not yet expose /admin/auth/providers. Deploy the updated admin sidecar, then re-sync.',
    )
  }
  if (!response.ok) {
    const detail = typeof data === 'object' && data && 'detail' in data
      ? String((data as { detail: unknown }).detail)
      : `HTTP ${response.status}`
    throw new Error(detail)
  }
}
