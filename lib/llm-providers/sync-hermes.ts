/**
 * Push organisation LLM credentials onto that organisation's Hermes VPS only.
 * User-scoped ("Just me") connections never sync — configure those on linked computers.
 */
import { callAgentPath } from '@/lib/agents/team'
import { callHermesJson } from '@/lib/hermes/server'
import type { AgentId } from '@/lib/agents/types'
import { getLlmProvider } from './providers'
import {
  getDecryptedLlmCredentials,
  getLlmProviderConnection,
  markLlmConnectionError,
  markLlmConnectionSynced,
} from './store'
import { resolveOrgLlmSyncTargets, type LlmSyncTarget } from './sync-targets'
import type { LlmProviderConnection } from './types'

export type SyncLlmConnectionResult = {
  synced: string[]
  failed: Array<{ agentId: string; error: string }>
  skippedReason?: 'user_scope_local_only' | 'no_org_vps_target'
  message?: string
}

export async function syncLlmConnectionToHermes(
  connectionId: string,
  options: { agentIds?: string[] } = {},
): Promise<SyncLlmConnectionResult> {
  const conn = await getLlmProviderConnection(connectionId)
  if (!conn || conn.status === 'revoked') {
    throw new Error('Connection not found')
  }

  if (conn.scope === 'user') {
    return {
      synced: [],
      failed: [],
      skippedReason: 'user_scope_local_only',
      message:
        'Personal credentials are not synced to any organisation VPS. Configure them on each linked computer during Hermes setup (or hermes model / hermes auth).',
    }
  }

  const credentials = await getDecryptedLlmCredentials(conn)
  if (!credentials) {
    throw new Error('Connection has no credentials')
  }

  const resolved = await resolveOrgLlmSyncTargets(conn.orgId, options.agentIds)
  if (!resolved.targets.length) {
    await markLlmConnectionError(connectionId, resolved.reasonIfEmpty || 'No organisation VPS sync target')
    return {
      synced: [],
      failed: [],
      skippedReason: 'no_org_vps_target',
      message: resolved.reasonIfEmpty,
    }
  }

  const def = getLlmProvider(conn.provider)
  const synced: string[] = []
  const failed: Array<{ agentId: string; error: string }> = []

  for (const target of resolved.targets) {
    try {
      if (credentials.access_token && credentials.refresh_token) {
        await pushOauthTokens(target, conn, credentials)
      } else if (def?.envVar && credentials.apiKey) {
        await pushApiKeyEnv(target, def.envVar, credentials.apiKey)
      } else if (conn.provider === 'copilot' && credentials.apiKey) {
        await pushApiKeyEnv(target, 'COPILOT_GITHUB_TOKEN', credentials.apiKey)
      } else {
        throw new Error('No syncable credential material')
      }
      synced.push(target.agentId)
    } catch (err) {
      failed.push({
        agentId: target.agentId,
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

async function pushApiKeyEnv(target: LlmSyncTarget, envVar: string, apiKey: string): Promise<void> {
  const body = JSON.stringify({ set: { [envVar]: apiKey }, unset: [] })
  if (target.hermesLink) {
    const { response, data } = await callHermesJson(target.hermesLink, '/admin/env', {
      method: 'PATCH',
      body,
    })
    if (!response.ok) throw upstreamError(data, response.status)
    return
  }
  const { response, data } = await callAgentPath(
    target.agentId as AgentId,
    '/admin/env',
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
    { runtimeTarget: target.runtimeTargetId },
  )
  if (!response.ok) throw upstreamError(data, response.status)
}

async function pushOauthTokens(
  target: LlmSyncTarget,
  conn: LlmProviderConnection,
  credentials: Record<string, string>,
): Promise<void> {
  const provider = conn.hermesProvider
  const body = JSON.stringify({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
    expires_in: credentials.expires_in ? Number(credentials.expires_in) : undefined,
    token_type: credentials.token_type || 'Bearer',
    ...(credentials.id_token ? { id_token: credentials.id_token } : {}),
    ...(credentials.scope ? { scope: credentials.scope } : {}),
  })
  const path = `/admin/auth/providers/${provider}`

  if (target.hermesLink) {
    const { response, data } = await callHermesJson(target.hermesLink, path, { method: 'PUT', body })
    if (response.status === 404) {
      throw new Error(
        'Organisation Hermes runtime does not yet expose /admin/auth/providers. Deploy the updated admin sidecar, then re-sync.',
      )
    }
    if (!response.ok) throw upstreamError(data, response.status)
    return
  }

  const { response, data } = await callAgentPath(
    target.agentId as AgentId,
    path,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body },
    { runtimeTarget: target.runtimeTargetId },
  )
  if (response.status === 404) {
    throw new Error(
      'Organisation VPS does not yet expose /admin/auth/providers. Deploy the updated admin sidecar, then re-sync.',
    )
  }
  if (!response.ok) throw upstreamError(data, response.status)
}

function upstreamError(data: unknown, status: number): Error {
  const detail = typeof data === 'object' && data && 'detail' in data
    ? String((data as { detail: unknown }).detail)
    : `HTTP ${status}`
  return new Error(detail)
}
