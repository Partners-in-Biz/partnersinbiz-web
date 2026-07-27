/**
 * Push LLM credentials onto Hermes runtimes.
 * - Org connections → organisation VPS only
 * - Personal connections → owner's linked computers; optionally org VPS when member access allows
 */
import { callAgentPath } from '@/lib/agents/team'
import { callHermesJson } from '@/lib/hermes/server'
import type { AgentId } from '@/lib/agents/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  memberMayUsePersonalLlmOnOrgVps,
  resolveMemberAccessPolicy,
  type MemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'
import type { OrgRole } from '@/lib/organizations/types'
import { getLlmProvider } from './providers'
import {
  getDecryptedLlmCredentials,
  getLlmProviderConnection,
  listLlmProviderConnections,
  markLlmConnectionError,
  markLlmConnectionSynced,
} from './store'
import {
  resolveOrgLlmSyncTargets,
  resolveUserLlmSyncTargets,
  type LlmSyncTarget,
} from './sync-targets'
import type { LlmProviderConnection } from './types'

export type SyncLlmConnectionResult = {
  synced: string[]
  failed: Array<{ agentId: string; error: string }>
  skippedReason?: 'no_sync_target' | 'org_provider_covers_vps'
  skippedVpsBecauseOrgProvider?: boolean
  includedOrgVps?: boolean
  message?: string
}

async function loadMemberAccessForSync(input: {
  orgId: string
  uid: string
}): Promise<{ accessPolicy: MemberAccessPolicy; orgRole: OrgRole | null }> {
  try {
    const snap = await adminDb.collection('orgMembers').doc(`${input.orgId}_${input.uid}`).get()
    if (!snap.exists) {
      return {
        accessPolicy: resolveMemberAccessPolicy({ role: 'member' }),
        orgRole: null,
      }
    }
    const data = snap.data() ?? {}
    const orgRole = (typeof data.role === 'string' ? data.role : 'member') as OrgRole
    return {
      accessPolicy: resolveMemberAccessPolicy({
        role: orgRole,
        accessScope: data.accessScope,
        accessPolicy: data.accessPolicy,
      }),
      orgRole,
    }
  } catch {
    return {
      accessPolicy: resolveMemberAccessPolicy({ role: 'member' }),
      orgRole: null,
    }
  }
}

export async function syncLlmConnectionToHermes(
  connectionId: string,
  options: { agentIds?: string[]; accessPolicy?: MemberAccessPolicy; orgRole?: OrgRole | null } = {},
): Promise<SyncLlmConnectionResult> {
  const conn = await getLlmProviderConnection(connectionId)
  if (!conn || conn.status === 'revoked') {
    throw new Error('Connection not found')
  }

  const credentials = await getDecryptedLlmCredentials(conn)
  if (!credentials) {
    throw new Error('Connection has no credentials')
  }

  if (conn.scope === 'org') {
    return pushToTargets(connectionId, conn, credentials, await resolveOrgTargets(conn.orgId, options.agentIds))
  }

  // Personal connection
  const ownerUid = conn.ownerUid
  if (!ownerUid) {
    throw new Error('Personal connection is missing ownerUid')
  }

  const membership = options.accessPolicy
    ? { accessPolicy: options.accessPolicy, orgRole: options.orgRole ?? null }
    : await loadMemberAccessForSync({ orgId: conn.orgId, uid: ownerUid })

  const allowOrgVps = memberMayUsePersonalLlmOnOrgVps(membership.accessPolicy, membership.orgRole)

  // Never overwrite an organisation-managed provider on the shared VPS.
  let skipOrgVpsBecauseOrgProvider = false
  if (allowOrgVps) {
    const orgConnections = await listLlmProviderConnections({ orgId: conn.orgId, uid: ownerUid })
    skipOrgVpsBecauseOrgProvider = orgConnections.some(
      (c) => c.scope === 'org'
        && c.status === 'connected'
        && c.hasCredentials
        && (c.hermesProvider === conn.hermesProvider || c.provider === conn.provider),
    )
  }

  const resolved = await resolveUserLlmSyncTargets({
    ownerUid,
    orgId: conn.orgId,
    accessPolicy: membership.accessPolicy,
    orgRole: membership.orgRole,
    preferredAgentIds: options.agentIds,
    includeOrgVps: allowOrgVps && !skipOrgVpsBecauseOrgProvider,
  })

  if (!resolved.targets.length) {
    await markLlmConnectionError(connectionId, resolved.reasonIfEmpty || 'No personal sync target')
    return {
      synced: [],
      failed: [],
      skippedReason: 'no_sync_target',
      skippedVpsBecauseOrgProvider: skipOrgVpsBecauseOrgProvider,
      includedOrgVps: false,
      message: resolved.reasonIfEmpty,
    }
  }

  const result = await pushToTargets(connectionId, conn, credentials, {
    targets: resolved.targets,
    reasonIfEmpty: resolved.reasonIfEmpty,
  })

  const notes: string[] = []
  if (resolved.includedOrgVps) {
    notes.push('Personal credentials were also written to the organisation VPS agent profiles.')
  } else if (skipOrgVpsBecauseOrgProvider) {
    notes.push(
      'Skipped organisation VPS — shared organisation credentials already cover this provider. Personal keys still sync to your linked computers.',
    )
  } else if (allowOrgVps) {
    notes.push('Organisation VPS was eligible but no VPS sync targets were available.')
  } else {
    notes.push('Personal credentials sync to your linked computers only. Ask an admin to enable personal LLM credentials on the organisation VPS in Team access if needed.')
  }

  return {
    ...result,
    skippedVpsBecauseOrgProvider: skipOrgVpsBecauseOrgProvider,
    includedOrgVps: resolved.includedOrgVps,
    message: [result.message, ...notes].filter(Boolean).join(' '),
    ...(result.synced.length === 0 && result.failed.length === 0
      ? { skippedReason: 'no_sync_target' as const }
      : {}),
  }
}

async function resolveOrgTargets(orgId: string, agentIds?: string[]) {
  const resolved = await resolveOrgLlmSyncTargets(orgId, agentIds)
  return {
    targets: resolved.targets,
    reasonIfEmpty: resolved.reasonIfEmpty,
  }
}

async function pushToTargets(
  connectionId: string,
  conn: LlmProviderConnection,
  credentials: Record<string, string>,
  resolved: { targets: LlmSyncTarget[]; reasonIfEmpty?: string },
): Promise<SyncLlmConnectionResult> {
  if (!resolved.targets.length) {
    await markLlmConnectionError(connectionId, resolved.reasonIfEmpty || 'No sync target')
    return {
      synced: [],
      failed: [],
      skippedReason: 'no_sync_target',
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
        'Hermes runtime does not yet expose /admin/auth/providers. Deploy the updated admin sidecar, then re-sync.',
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
      'Runtime does not yet expose /admin/auth/providers. Deploy the updated admin sidecar / linked runtime, then re-sync.',
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
