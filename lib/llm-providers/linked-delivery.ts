import { adminDb } from '@/lib/firebase/admin'
import { enqueueAgentHostJob } from '@/lib/linked-computers/agent-job-store'
import { preferredPortForAgent } from '@/lib/linked-computers/agent-jobs'
import { linkedDeviceActorUserId, linkedDeviceOwnerType } from '@/lib/linked-computers/policy'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import {
  connectionCredentialVersion,
  listConnectionLlmCredentialBindings,
  updateLlmCredentialBinding,
} from './bindings'
import { getLlmProvider } from './providers'
import type { LlmProviderConnection } from './types'
import type { LlmSyncTarget } from './sync-targets'

function canaryModelFor(connection: LlmProviderConnection): string | null {
  const discovered = Array.isArray(connection.meta?.discoveredModels)
    ? connection.meta.discoveredModels.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : null
  return discovered || getLlmProvider(connection.provider)?.curatedModels[0] || null
}

export async function enqueueCredentialDelivery(input: {
  connection: LlmProviderConnection
  bindingId: string
  target: LlmSyncTarget
}): Promise<{ jobId: string }> {
  const { connection, target } = input
  if (!target.deviceId) throw new Error('Credential delivery requires a linked runtime device')

  const deviceSnap = await adminDb.collection('linked_devices').doc(target.deviceId).get()
  if (!deviceSnap.exists) throw new Error('Linked computer no longer exists')
  const device = { deviceId: target.deviceId, ...deviceSnap.data() } as LinkedDevice
  const ownerType = linkedDeviceOwnerType(device)
  const authorizedOwner = connection.scope === 'user'
    ? ownerType === 'user' && Boolean(connection.ownerUid) && device.ownerUserId === connection.ownerUid
    : ownerType === 'organization' && device.ownerOrgId === connection.orgId
  if (device.status !== 'active' || !authorizedOwner) {
    throw new Error('Linked computer is not active or is owned by another account')
  }
  const deviceCredentialVersion = Number(device.credentialVersion)
  if (!Number.isInteger(deviceCredentialVersion) || deviceCredentialVersion < 1) {
    throw new Error('Linked computer must reconnect before credentials can be delivered')
  }

  const definition = getLlmProvider(connection.provider)
  const canaryModel = canaryModelFor(connection)
  if (!definition || !canaryModel) throw new Error('Provider has no verified canary model')
  const credentialVersion = connectionCredentialVersion(connection)
  // API-key providers (DeepSeek, xAI key, OpenAI API, etc.) are applied to the
  // running gateway's env without a profile restart. OAuth-token providers
  // (xai-oauth, openai-codex) need the profile idle so its gateway can reload
  // the refreshed token. Use the stored connection auth kind so api_key_or_oauth
  // providers (e.g. Anthropic with an API key) take the fast env path.
  const oauthConnection = connection.authKind === 'oauth' || connection.authKind === 'oauth_token'
  const applyMode: 'env' | 'restart' = oauthConnection || !definition.envVar ? 'restart' : 'env'
  const job = await enqueueAgentHostJob({
    idempotencyKey: `sync-credential:${input.bindingId}:v${credentialVersion}`,
    deviceId: target.deviceId,
    orgId: connection.orgId,
    actorUserId: connection.scope === 'user'
      ? connection.ownerUid!
      : linkedDeviceActorUserId(device) || connection.createdBy,
    credentialVersion: deviceCredentialVersion,
    kind: 'sync-credential',
    payload: {
      agentId: target.agentId,
      policyVersion: null,
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: preferredPortForAgent(target.agentId),
      protocolVersion: 3,
      credentialDelivery: {
        bindingId: input.bindingId,
        connectionId: connection.id,
        credentialVersion,
        provider: connection.provider,
        hermesProvider: connection.hermesProvider,
        envVar: definition.envVar ?? null,
        canaryModel,
        applyMode,
      },
    },
  })
  await updateLlmCredentialBinding(input.bindingId, {
    status: 'delivering',
    liveAuthVerified: false,
    lastError: null,
    deliveryJobId: job.jobId,
  })
  return { jobId: job.jobId }
}

export const enqueuePersonalCredentialDelivery = enqueueCredentialDelivery

export async function enqueueCredentialRevocations(
  connection: LlmProviderConnection,
): Promise<string[]> {
  const definition = getLlmProvider(connection.provider)
  const canaryModel = canaryModelFor(connection)
  if (!definition || !canaryModel) return []
  const oauthConnection = connection.authKind === 'oauth' || connection.authKind === 'oauth_token'
  const applyMode: 'env' | 'restart' = oauthConnection || !definition.envVar ? 'restart' : 'env'
  const bindings = await listConnectionLlmCredentialBindings(connection.id)
  const jobIds: string[] = []
  for (const binding of bindings) {
    if (!binding.deviceId || binding.status === 'revoked') continue
    const deviceSnap = await adminDb.collection('linked_devices').doc(binding.deviceId).get()
    const device = deviceSnap.data() as LinkedDevice | undefined
    const deviceCredentialVersion = Number(device?.credentialVersion)
    const ownerType = device ? linkedDeviceOwnerType(device) : null
    const authorizedOwner = connection.scope === 'user'
      ? ownerType === 'user' && Boolean(connection.ownerUid) && device?.ownerUserId === connection.ownerUid
      : ownerType === 'organization' && device?.ownerOrgId === connection.orgId
    if (!deviceSnap.exists || device?.status !== 'active'
      || !authorizedOwner
      || !Number.isInteger(deviceCredentialVersion)
      || deviceCredentialVersion < 1) continue
    const job = await enqueueAgentHostJob({
      idempotencyKey: `revoke-credential:${binding.id}:v${binding.credentialVersion}`,
      deviceId: binding.deviceId,
      orgId: connection.orgId,
      actorUserId: connection.scope === 'user'
        ? connection.ownerUid!
        : linkedDeviceActorUserId(device) || connection.createdBy,
      credentialVersion: deviceCredentialVersion,
      kind: 'revoke-credential',
      payload: {
        agentId: binding.agentId as import('@/lib/agents/types').AgentId,
        policyVersion: null,
        keepInSync: false,
        runtimeSkills: [],
        pibSkills: [],
        vpsExternalDir: null,
        preferredPort: preferredPortForAgent(binding.agentId),
        protocolVersion: 3,
        credentialDelivery: {
          bindingId: binding.id,
          connectionId: connection.id,
          credentialVersion: binding.credentialVersion,
          provider: connection.provider,
          hermesProvider: connection.hermesProvider,
          envVar: definition.envVar ?? null,
          canaryModel,
          applyMode,
        },
      },
    })
    jobIds.push(job.jobId)
  }
  return jobIds
}

export const enqueuePersonalCredentialRevocations = enqueueCredentialRevocations
