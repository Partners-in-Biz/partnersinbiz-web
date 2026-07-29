/**
 * Push LLM credentials onto Hermes runtimes.
 * - Org connections → organisation VPS only
 * - Personal connections → owner's linked computers through authenticated pull jobs
 */
import { callAgentPath } from '@/lib/agents/team'
import { callHermesJson } from '@/lib/hermes/server'
import type { AgentId } from '@/lib/agents/types'
import { adminDb } from '@/lib/firebase/admin'
import { resolveMemberAccessPolicy, type MemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import type { OrgRole } from '@/lib/organizations/types'
import { getLlmProvider } from './providers'
import {
  getDecryptedLlmCredentials,
  getLlmProviderConnection,
  markLlmConnectionError,
  markLlmConnectionSynced,
} from './store'
import { putDesiredLlmCredentialBinding, updateLlmCredentialBinding } from './bindings'
import { enqueueCredentialDelivery } from './linked-delivery'
import {
  resolveOrgLlmSyncTargets,
  resolveUserLlmSyncTargets,
  type LlmSyncTarget,
} from './sync-targets'
import type { LlmProviderConnection } from './types'

export type SyncLlmConnectionResult = {
  synced: string[]
  queued: Array<{ agentId: string; bindingId: string; jobId: string }>
  failed: Array<{ agentId: string; error: string }>
  verified?: Array<{ agentId: string; usable: boolean; detail?: string }>
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

  const resolved = await resolveUserLlmSyncTargets({
    ownerUid,
    orgId: conn.orgId,
    accessPolicy: membership.accessPolicy,
    orgRole: membership.orgRole,
    preferredAgentIds: options.agentIds,
    includeOrgVps: false,
  })

  if (!resolved.targets.length) {
    await markLlmConnectionError(connectionId, resolved.reasonIfEmpty || 'No personal sync target')
    return {
      synced: [],
      queued: [],
      failed: [],
      skippedReason: 'no_sync_target',
      skippedVpsBecauseOrgProvider: false,
      includedOrgVps: false,
      message: resolved.reasonIfEmpty,
    }
  }

  const result = await pushToTargets(connectionId, conn, credentials, {
    targets: resolved.targets,
    reasonIfEmpty: resolved.reasonIfEmpty,
  })

  const notes = ['Personal credentials are delivered only to computers owned by your account. They are never copied to the shared organisation VPS.']

  return {
    ...result,
    skippedVpsBecauseOrgProvider: false,
    includedOrgVps: false,
    message: [result.message, ...notes].filter(Boolean).join(' '),
    ...(result.synced.length === 0 && result.queued.length === 0 && result.failed.length === 0
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
      queued: [],
      failed: [],
      skippedReason: 'no_sync_target',
      message: resolved.reasonIfEmpty,
    }
  }

  const def = getLlmProvider(conn.provider)
  const synced: string[] = []
  const queued: Array<{ agentId: string; bindingId: string; jobId: string }> = []
  const failed: Array<{ agentId: string; error: string }> = []
  const verified: Array<{ agentId: string; usable: boolean; detail?: string }> = []
  const isOauth = Boolean(credentials.access_token && credentials.refresh_token)
  const envVar = def?.envVar
    || (conn.provider === 'copilot' ? 'COPILOT_GITHUB_TOKEN' : undefined)
  const discoveredCanaryModel = Array.isArray(conn.meta?.discoveredModels)
    ? conn.meta.discoveredModels.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : undefined

  for (const target of resolved.targets) {
    const binding = await putDesiredLlmCredentialBinding({ connection: conn, target })
    try {
      if (target.deviceId) {
        const delivery = await enqueueCredentialDelivery({
          connection: conn,
          bindingId: binding.id,
          target,
        })
        queued.push({ agentId: target.agentId, bindingId: binding.id, jobId: delivery.jobId })
        continue
      }
      if (isOauth) {
        await pushOauthTokens(target, conn, credentials)
      } else if (envVar && credentials.apiKey) {
        await pushApiKeyEnv(target, envVar, credentials.apiKey)
      } else {
        throw new Error('No syncable credential material')
      }

      const check = await verifyCredentialOnTarget(target, {
        hermesProvider: conn.hermesProvider,
        isOauth,
        envVar,
        canaryModel: discoveredCanaryModel || def?.curatedModels[0],
      })
      verified.push({
        agentId: target.agentId,
        usable: check.usable,
        ...(check.detail ? { detail: check.detail } : {}),
      })
      if (!check.usable) {
        await updateLlmCredentialBinding(binding.id, {
          status: 'failed',
          liveAuthVerified: false,
          lastError: check.detail || 'Provider canary failed',
        })
        failed.push({
          agentId: target.agentId,
          error: check.detail
            || 'Credential write succeeded but Hermes on this machine cannot use the provider yet.',
        })
        continue
      }
      await updateLlmCredentialBinding(binding.id, {
        status: 'ready',
        liveAuthVerified: true,
        verifiedModelIds: check.modelIds ?? [],
        lastError: null,
      })
      synced.push(target.agentId)
    } catch (err) {
      await updateLlmCredentialBinding(binding.id, {
        status: 'failed',
        liveAuthVerified: false,
        lastError: err instanceof Error ? err.message : 'Sync failed',
      }).catch(() => undefined)
      failed.push({
        agentId: target.agentId,
        error: err instanceof Error ? err.message : 'Sync failed',
      })
      verified.push({
        agentId: target.agentId,
        usable: false,
        detail: err instanceof Error ? err.message : 'Sync failed',
      })
    }
  }

  if (synced.length) {
    await markLlmConnectionSynced(connectionId, synced)
  } else if (failed.length) {
    await markLlmConnectionError(connectionId, failed[0].error)
  }

  const verifyNote = verified.some((v) => !v.usable)
    ? 'Some targets rejected verification after write — Hermes must accept the provider before models are selectable in chat.'
    : verified.length
      ? 'Verified Hermes can load the synced credentials on each target.'
      : undefined

  return {
    synced,
    queued,
    failed,
    verified,
    ...(verifyNote ? { message: verifyNote } : {}),
  }
}

/**
 * Confirm the target runtime actually has usable credentials after write.
 * OAuth: Hermes-native nested tokens must be present (`hermes_shape` / usable).
 * API key: env var must be set on the profile.
 */
async function verifyCredentialOnTarget(
  target: LlmSyncTarget,
  input: { hermesProvider: string; isOauth: boolean; envVar?: string; canaryModel?: string },
): Promise<{ usable: boolean; detail?: string; modelIds?: string[] }> {
  try {
    if (input.isOauth) {
      const path = '/admin/auth/providers'
      const { response, data } = target.hermesLink
        ? await callHermesJson(target.hermesLink, path, { method: 'GET' })
        : await callAgentPath(
          target.agentId as AgentId,
          path,
          { method: 'GET' },
          { runtimeTarget: target.runtimeTargetId },
        )
      if (!response.ok) {
        return {
          usable: false,
          detail: `Post-sync auth check failed (HTTP ${response.status}). Deploy the updated admin sidecar, then re-sync.`,
        }
      }
      const providers = (data && typeof data === 'object' && 'providers' in data)
        ? (data as { providers?: Record<string, Record<string, unknown>> }).providers
        : null
      const state = providers?.[input.hermesProvider]
      if (!state || typeof state !== 'object') {
        return {
          usable: false,
          detail: `Hermes on ${target.label} has no ${input.hermesProvider} entry after sync.`,
        }
      }
      // New sidecars report hermes_shape/usable for nested tokens Hermes can read.
      // Older sidecars only had flat has_access_token — those still break Hermes.
      const hasHermesShapeField = 'hermes_shape' in state || 'usable' in state
      if (!hasHermesShapeField) {
        return {
          usable: false,
          detail: `Hermes admin on ${target.label} is outdated and cannot prove OAuth tokens are in the Hermes-native shape. Deploy the updated admin sidecar, then re-sync.`,
        }
      }
      const usable = state.usable === true
        || (state.hermes_shape === true && state.has_access_token === true && state.has_refresh_token === true)
      if (!usable) {
        return {
          usable: false,
          detail: `Hermes on ${target.label} still reports unusable ${input.hermesProvider} OAuth tokens (missing nested tokens shape). Re-sync after the admin sidecar update.`,
        }
      }
      return liveProviderCanary(target, input.hermesProvider, input.canaryModel)
    }

    if (!input.envVar) {
      return { usable: false, detail: 'No env var to verify for this provider' }
    }
    const path = '/admin/env'
    const { response, data } = target.hermesLink
      ? await callHermesJson(target.hermesLink, path, { method: 'GET' })
      : await callAgentPath(
        target.agentId as AgentId,
        path,
        { method: 'GET' },
        { runtimeTarget: target.runtimeTargetId },
      )
    if (!response.ok) {
      return { usable: false, detail: `Post-sync env check failed (HTTP ${response.status})` }
    }
    const env = (data && typeof data === 'object' && 'env' in data)
      ? (data as { env?: Record<string, { is_set?: boolean }> }).env
      : null
    const isSet = Boolean(env?.[input.envVar]?.is_set)
    if (!isSet) {
      return {
        usable: false,
        detail: `${input.envVar} is not set on Hermes for ${target.label} after sync.`,
      }
    }
    return liveProviderCanary(target, input.hermesProvider, input.canaryModel)
  } catch (err) {
    return {
      usable: false,
      detail: err instanceof Error ? err.message : 'Post-sync verification failed',
    }
  }
}

async function liveProviderCanary(
  target: LlmSyncTarget,
  provider: string,
  model?: string,
): Promise<{ usable: boolean; detail?: string; modelIds?: string[] }> {
  if (!model) return { usable: false, detail: `No canary model is registered for ${provider}` }
  const body = JSON.stringify({
    provider,
    model,
    input: 'Reply exactly PIB_CREDENTIAL_OK. Do not use tools.',
  })
  const path = '/v1/responses'
  const { response, data } = target.hermesLink
    ? await callHermesJson(target.hermesLink, path, { method: 'POST', body })
    : await callAgentPath(
      target.agentId as AgentId,
      path,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      { runtimeTarget: target.runtimeTargetId },
    )
  if (!response.ok) {
    return { usable: false, detail: `Live ${provider} canary failed on ${target.label} (HTTP ${response.status})` }
  }
  const serialized = JSON.stringify(data)
  if (!serialized.includes('PIB_CREDENTIAL_OK')) {
    return { usable: false, detail: `Live ${provider} canary returned an unexpected response on ${target.label}` }
  }
  const modelsPath = '/v1/models'
  const modelsResult = target.hermesLink
    ? await callHermesJson(target.hermesLink, modelsPath, { method: 'GET' })
    : await callAgentPath(
      target.agentId as AgentId,
      modelsPath,
      { method: 'GET' },
      { runtimeTarget: target.runtimeTargetId },
    )
  const entries = modelsResult.data && typeof modelsResult.data === 'object'
    ? ((modelsResult.data as { data?: unknown[]; models?: unknown[] }).data
      ?? (modelsResult.data as { models?: unknown[] }).models
      ?? [])
    : []
  const modelIds = Array.isArray(entries)
    ? entries.flatMap((entry) => typeof entry === 'string'
      ? [entry]
      : entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
        ? [String((entry as { id: string }).id)]
        : [])
    : []
  return {
    usable: true,
    detail: `Live ${provider} inference succeeded on ${target.label}`,
    modelIds,
  }
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
