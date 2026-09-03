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
  markLlmConnectionSyncQueued,
  markLlmConnectionSyncWarning,
  markLlmConnectionSynced,
} from './store'
import { putDesiredLlmCredentialBinding, updateLlmCredentialBinding } from './bindings'
import { enqueueCredentialDelivery } from './linked-delivery'
import {
  resolveOrgLlmSyncTargets,
  resolveOrgShareLinkedComputerTargets,
  resolveUserLlmSyncTargets,
  type LlmSyncTarget,
} from './sync-targets'
import type { LlmProviderConnection } from './types'
import { ensureFreshLlmProviderConnection, xaiCredentialsNeedRefresh } from './refresh'

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

export type LlmCredentialDeliveryDecision =
  | { mode: 'oauth' }
  | { mode: 'env'; envVar: string; value: string }
  | { mode: 'none' }

/**
 * Decide how a saved connection's credentials are pushed to a Hermes target.
 *
 * Anthropic OAuth tokens are deliberately delivered through the env-var path as
 * CLAUDE_CODE_OAUTH_TOKEN — Hermes reads ANTHROPIC_API_KEY, then ANTHROPIC_TOKEN,
 * then CLAUDE_CODE_OAUTH_TOKEN natively, so no admin-auth provider write or
 * profile restart is needed. Other OAuth providers (xai-oauth, openai-codex,
 * nous) keep the nested-token /admin/auth/providers path.
 */
export function resolveLlmDeliveryForConnection(
  conn: Pick<LlmProviderConnection, 'provider'>,
  credentials: Record<string, string>,
): LlmCredentialDeliveryDecision {
  const isOauth = Boolean(credentials.access_token && credentials.refresh_token)
  if (conn.provider === 'anthropic' && credentials.access_token) {
    return { mode: 'env', envVar: 'CLAUDE_CODE_OAUTH_TOKEN', value: credentials.access_token }
  }
  if (isOauth) return { mode: 'oauth' }
  const def = getLlmProvider(conn.provider)
  const envVar = def?.envVar || (conn.provider === 'copilot' ? 'COPILOT_GITHUB_TOKEN' : undefined)
  if (envVar && credentials.apiKey) return { mode: 'env', envVar, value: credentials.apiKey }
  return { mode: 'none' }
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
  const savedConnection = await getLlmProviderConnection(connectionId)
  if (!savedConnection || savedConnection.status === 'revoked') {
    throw new Error('Connection not found')
  }
  const conn = await ensureFreshLlmProviderConnection(savedConnection)

  const credentials = await getDecryptedLlmCredentials(conn)
  if (!credentials) {
    throw new Error('Connection has no credentials')
  }

  if (conn.scope === 'org') {
    return pushToTargets(connectionId, conn, credentials, await resolveOrgTargets(conn, options.agentIds))
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
    await markLlmConnectionSyncWarning(connectionId, resolved.reasonIfEmpty || 'No personal sync target')
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

/**
 * Renew a managed xAI OAuth access token before a selected chat starts.
 *
 * xAI refresh tokens rotate and must remain in the control plane. Hermes
 * profiles deliberately receive access-only credentials, so a profile cannot
 * recover on its own once that bearer expires. This is the send-time backstop
 * for the scheduled refresh worker: refresh once centrally, then prove the
 * exact selected agent profile has received the new generation.
 */
export async function ensureFreshXaiCredentialForDispatch(input: {
  connectionId: string
  agentId: string
}): Promise<{ refreshed: boolean }> {
  const connection = await getLlmProviderConnection(input.connectionId)
  if (!connection || connection.status === 'revoked') {
    throw new Error('Selected LLM account is no longer available')
  }
  if (connection.provider !== 'xai-oauth') return { refreshed: false }
  if (connection.status === 'reauth_required' || connection.status === 'pending_oauth') {
    throw new Error('xAI OAuth account must be reconnected in Settings before this chat can run')
  }

  const credentials = await getDecryptedLlmCredentials(connection)
  if (!credentials?.access_token) {
    throw new Error('xAI OAuth account has no access token. Reconnect this account in Settings.')
  }
  if (!xaiCredentialsNeedRefresh(credentials)) return { refreshed: false }

  const sync = await syncLlmConnectionToHermes(connection.id, { agentIds: [input.agentId] })
  const failed = sync.failed.find((item) => item.agentId === input.agentId)
  if (failed) {
    throw new Error(`xAI credential refresh could not reach ${input.agentId}: ${failed.error}`)
  }
  if (sync.queued.some((item) => item.agentId === input.agentId)) {
    throw new Error('xAI credentials are refreshing on this computer. Retry this chat once the profile is live-ready.')
  }
  if (!sync.synced.includes(input.agentId)) {
    throw new Error('xAI credential refresh did not verify the selected agent profile')
  }
  return { refreshed: true }
}

async function resolveOrgTargets(connection: LlmProviderConnection, agentIds?: string[]) {
  const orgTargets = await resolveOrgLlmSyncTargets(connection.orgId, agentIds)
  const share = await resolveOrgShareLinkedComputerTargets({
    connection,
    preferredAgentIds: agentIds,
  })
  const targets = [...orgTargets.targets, ...share.targets]
  return {
    targets,
    reasonIfEmpty: targets.length ? undefined : orgTargets.reasonIfEmpty || share.reasonIfEmpty,
  }
}

async function pushToTargets(
  connectionId: string,
  conn: LlmProviderConnection,
  credentials: Record<string, string>,
  resolved: { targets: LlmSyncTarget[]; reasonIfEmpty?: string },
): Promise<SyncLlmConnectionResult> {
  if (!resolved.targets.length) {
    await markLlmConnectionSyncWarning(connectionId, resolved.reasonIfEmpty || 'No sync target')
    return {
      synced: [],
      queued: [],
      failed: [],
      skippedReason: 'no_sync_target',
      message: resolved.reasonIfEmpty,
    }
  }

  const def = getLlmProvider(conn.provider)
  const delivery = resolveLlmDeliveryForConnection(conn, credentials)
  const isOauth = delivery.mode === 'oauth'
  const envVar = delivery.mode === 'env' ? delivery.envVar : undefined
  const discoveredCanaryModel = Array.isArray(conn.meta?.discoveredModels)
    ? conn.meta.discoveredModels.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : undefined
  const synced: string[] = []
  const queued: Array<{ agentId: string; bindingId: string; jobId: string }> = []
  const failed: Array<{ agentId: string; error: string }> = []
  const verified: Array<{ agentId: string; usable: boolean; detail?: string }> = []

  for (const target of resolved.targets) {
    const binding = await putDesiredLlmCredentialBinding({ connection: conn, target })
    try {
      if (target.deviceId) {
        const deliveryJob = await enqueueCredentialDelivery({
          connection: conn,
          bindingId: binding.id,
          target,
        })
        queued.push({ agentId: target.agentId, bindingId: binding.id, jobId: deliveryJob.jobId })
        continue
      }
      if (delivery.mode === 'oauth') {
        await pushOauthTokens(target, conn, credentials)
      } else if (delivery.mode === 'env' && delivery.envVar && delivery.value) {
        await pushApiKeyEnv(target, delivery.envVar, delivery.value)
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
  } else if (queued.length && !failed.length) {
    await markLlmConnectionSyncQueued(connectionId)
  } else if (failed.length) {
    await markLlmConnectionSyncWarning(connectionId, failed[0].error)
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
        || (state.hermes_shape === true
          && state.has_access_token === true
          && (input.hermesProvider === 'xai-oauth' || state.has_refresh_token === true))
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
    // xAI refresh tokens are rotating, single-use credentials. The web app is
    // their sole owner; runtimes receive only the current access token.
    ...(conn.provider === 'xai-oauth' ? {} : { refresh_token: credentials.refresh_token }),
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
