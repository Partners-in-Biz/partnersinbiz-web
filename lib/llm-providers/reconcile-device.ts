import { adminDb } from '@/lib/firebase/admin'
import { linkedDeviceOwnerType } from '@/lib/linked-computers/policy'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import {
  connectionCredentialVersion,
  llmCredentialBindingId,
  putDesiredLlmCredentialBinding,
} from './bindings'
import { enqueueCredentialDelivery } from './linked-delivery'
import type { LlmProviderConnection, LlmCredentialBinding } from './types'
import type { LlmSyncTarget } from './sync-targets'
import { ensureFreshLlmProviderConnection } from './refresh'

const FAILED_RETRY_DELAY_MS = 5 * 60_000
const IN_FLIGHT_RETRY_DELAY_MS = 15 * 60_000

function versionParts(value: string): number[] {
  return value.split('.').map((part) => Number(part.replace(/\D.*$/, '')) || 0)
}

export function runtimeSupportsCredentialDelivery(version: string): boolean {
  const actual = versionParts(version)
  const required = [1, 1, 13]
  for (let index = 0; index < required.length; index += 1) {
    if ((actual[index] ?? 0) !== required[index]) return (actual[index] ?? 0) > required[index]
  }
  return true
}

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis()
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function credentialBindingNeedsDelivery(input: {
  binding?: LlmCredentialBinding
  credentialVersion: number
  nowMs?: number
}): boolean {
  const binding = input.binding
  if (!binding || binding.credentialVersion !== input.credentialVersion) return true
  if (binding.status === 'ready' && binding.liveAuthVerified) return false
  if (['desired', 'delivering', 'stored'].includes(binding.status)) {
    return (input.nowMs ?? Date.now()) - timestampMillis(binding.updatedAt) >= IN_FLIGHT_RETRY_DELAY_MS
  }
  if (binding.status === 'failed') {
    return (input.nowMs ?? Date.now()) - timestampMillis(binding.updatedAt) >= FAILED_RETRY_DELAY_MS
  }
  return binding.status !== 'revoked'
}

/**
 * Fleet backstop: every connected account is delivered to every eligible
 * healthy profile after an install, runtime upgrade, or newly discovered agent.
 */
export async function reconcileLlmCredentialsForLinkedDevice(input: {
  deviceId: string
  availableAgentIds: string[]
}): Promise<{ queued: number; skipped: number }> {
  const deviceSnapshot = await adminDb.collection('linked_devices').doc(input.deviceId).get()
  if (!deviceSnapshot.exists) return { queued: 0, skipped: 0 }
  const device = { deviceId: input.deviceId, ...deviceSnapshot.data() } as LinkedDevice
  if (device.status !== 'active' || !runtimeSupportsCredentialDelivery(device.runtimeVersion || '0.0.0')) {
    return { queued: 0, skipped: 0 }
  }

  const ownerType = linkedDeviceOwnerType(device)
  const connectionQuery = ownerType === 'organization'
    ? adminDb.collection('llm_provider_connections').where('scope', '==', 'org').where('orgId', '==', device.ownerOrgId)
    : adminDb.collection('llm_provider_connections').where('scope', '==', 'user').where('ownerUid', '==', device.ownerUserId)
  const [connectionsSnapshot, bindingsSnapshot] = await Promise.all([
    connectionQuery.get(),
    adminDb.collection('llm_credential_bindings').where('deviceId', '==', input.deviceId).get(),
  ])
  const candidates = connectionsSnapshot.docs
    .map((doc) => ({ ...(doc.data() as LlmProviderConnection), id: doc.id }))
    .filter((connection) => (
      connection.status === 'connected'
      || (connection.provider === 'xai-oauth' && connection.status === 'invalid')
    ) && Boolean(connection.credentialsEnc))
    .slice(0, 32)
  const connections: LlmProviderConnection[] = []
  for (const connection of candidates) {
    try {
      connections.push(await ensureFreshLlmProviderConnection(connection))
    } catch {
      // Re-authentication state is recorded on the connection by the refresh broker.
    }
  }
  const bindings = new Map(bindingsSnapshot.docs.map((doc) => [
    doc.id,
    { ...(doc.data() as LlmCredentialBinding), id: doc.id },
  ]))
  const agentIds = [...new Set(input.availableAgentIds)]
    .filter((agentId) => /^[a-z][a-z0-9._-]{0,39}$/.test(agentId))
    .slice(0, 100)

  let queued = 0
  let skipped = 0
  for (const connection of connections) {
    for (const agentId of agentIds) {
      const target: LlmSyncTarget = {
        kind: ownerType === 'organization' ? 'org_linked_vps' : 'user_linked_computer',
        agentId: agentId as import('@/lib/agents/types').AgentId,
        runtimeTargetId: device.runtimeTargetId,
        deviceId: device.deviceId,
        label: `${device.label || (ownerType === 'organization' ? 'Org VPS' : 'Linked computer')} · ${agentId}`,
      }
      const id = llmCredentialBindingId({
        connectionId: connection.id,
        runtimeTargetId: target.runtimeTargetId,
        deviceId: target.deviceId,
        agentId,
      })
      if (!credentialBindingNeedsDelivery({
        binding: bindings.get(id),
        credentialVersion: connectionCredentialVersion(connection),
      })) {
        skipped += 1
        continue
      }
      try {
        const binding = await putDesiredLlmCredentialBinding({ connection, target })
        await enqueueCredentialDelivery({ connection, bindingId: binding.id, target })
        queued += 1
      } catch {
        // One provider/profile must never prevent heartbeat or other deliveries.
        skipped += 1
      }
    }
  }
  return { queued, skipped }
}
