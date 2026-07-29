import { db } from './firestore'

type BindingRow = {
  id: string
  connectionId: string
  runtimeTargetId: string
  deviceId?: string | null
  orgId: string
  ownerUid?: string | null
  scope: 'org' | 'user'
  agentId: string
  provider: string
  hermesProvider: string
  status: string
  liveAuthVerified: boolean
  credentialVersion: number
}

export type WatcherLlmRoute = {
  provider: string
  connectionId: string
  credentialBindingId: string
  resolvedSource: 'org' | 'personal'
  runtimeTargetId: string
}

export async function resolveWatcherRuntimePreference(input: {
  runtimeTargetId?: string | null
  orgId: string
  ownerUid: string
  agentId: string
  resolvedSource?: string | null
}): Promise<string | null> {
  const requested = input.runtimeTargetId?.trim() || ''
  if (!requested) {
    return input.resolvedSource === 'personal' ? 'local'
      : input.resolvedSource === 'org' ? 'vps'
        : null
  }
  if (!requested.startsWith('linked-device:')) return requested
  const deviceId = requested.slice('linked-device:'.length)
  const snapshot = await db.collection('linked_devices').doc(deviceId).get()
  const device = snapshot.data()
  if (!snapshot.exists || device?.status !== 'active' || !includesAgent(device.availableAgentIds, input.agentId)) {
    throw new Error('Selected task machine is offline or does not host this agent; automatic credential sync will retry.')
  }
  if (device.ownerType === 'organization') {
    if (device.ownerOrgId !== input.orgId) throw new Error('Selected task machine belongs to another organisation.')
    return 'vps'
  }
  if (device.ownerUserId !== input.ownerUid) throw new Error('Selected task machine belongs to another member.')
  return 'local'
}

function providerFamily(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (['xai', 'xai-oauth', 'grok', 'grok-oauth'].includes(normalized)) return 'xai'
  if (['openai', 'openai-codex', 'codex'].includes(normalized)) return 'openai-codex'
  if (normalized === 'google') return 'gemini'
  return normalized
}

function includesAgent(value: unknown, agentId: string): boolean {
  return Array.isArray(value) && value.some((candidate) => candidate === agentId)
}

async function resolvePhysicalRuntime(input: {
  requestedRuntimeTargetId: string
  orgId: string
  ownerUid: string
  agentId: string
}): Promise<{ runtimeTargetId: string; scope: 'org' | 'user' }> {
  const requested = input.requestedRuntimeTargetId
  if (requested.startsWith('linked-device:')) {
    const deviceId = requested.slice('linked-device:'.length)
    const snapshot = await db.collection('linked_devices').doc(deviceId).get()
    const device = snapshot.data()
    if (!snapshot.exists || device?.status !== 'active' || !includesAgent(device.availableAgentIds, input.agentId)) {
      throw new Error('Selected task machine is offline or does not host this agent; automatic credential sync will retry.')
    }
    if (device.ownerType === 'organization') {
      if (device.ownerOrgId !== input.orgId) throw new Error('Selected task machine belongs to another organisation.')
      return { runtimeTargetId: String(device.runtimeTargetId || requested), scope: 'org' }
    }
    if (device.ownerUserId !== input.ownerUid) throw new Error('Selected task machine belongs to another member.')
    return { runtimeTargetId: String(device.runtimeTargetId || requested), scope: 'user' }
  }

  const ownerField = requested === 'local' ? 'ownerUserId' : 'ownerOrgId'
  const ownerValue = requested === 'local' ? input.ownerUid : input.orgId
  const snapshot = await db.collection('linked_devices').where(ownerField, '==', ownerValue).get()
  const device = snapshot.docs
    .map((doc) => ({ deviceId: doc.id, ...doc.data() } as Record<string, unknown> & { deviceId: string }))
    .find((row) => row.status === 'active'
      && includesAgent(row.availableAgentIds, input.agentId)
      && (requested === 'local' || row.deviceKind === 'vps'))
  if (device) {
    return {
      runtimeTargetId: String(device.runtimeTargetId || `linked-device:${device.deviceId}`),
      scope: requested === 'local' ? 'user' : 'org',
    }
  }
  return { runtimeTargetId: requested, scope: requested === 'local' ? 'user' : 'org' }
}

export async function resolveWatcherLlmRoute(input: {
  orgId: string
  ownerUid: string
  agentId: string
  provider: string | null
  connectionId?: string | null
  runtimeTargetId: string
}): Promise<WatcherLlmRoute | null> {
  if (!input.provider) return null
  const runtime = await resolvePhysicalRuntime({
    requestedRuntimeTargetId: input.runtimeTargetId,
    orgId: input.orgId,
    ownerUid: input.ownerUid,
    agentId: input.agentId,
  })
  const snapshot = await db.collection('llm_credential_bindings')
    .where('runtimeTargetId', '==', runtime.runtimeTargetId)
    .get()
  const requestedFamily = providerFamily(input.provider)
  const binding = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as BindingRow))
    .find((row) => row.orgId === input.orgId
      && row.agentId === input.agentId
      && row.scope === runtime.scope
      && (runtime.scope === 'org' || row.ownerUid === input.ownerUid)
      && row.status === 'ready'
      && row.liveAuthVerified === true
      && (!input.connectionId || row.connectionId === input.connectionId)
      && providerFamily(row.hermesProvider || row.provider) === requestedFamily)
  if (!binding) {
    throw new Error(
      `The selected ${runtime.scope === 'user' ? 'personal' : 'organisation'} ${input.provider} account is not live-ready on this machine and ${input.agentId} profile; automatic credential sync will retry.`,
    )
  }
  return {
    provider: binding.hermesProvider || input.provider,
    connectionId: binding.connectionId,
    credentialBindingId: binding.id,
    resolvedSource: binding.scope === 'user' ? 'personal' : 'org',
    runtimeTargetId: runtime.runtimeTargetId,
  }
}
