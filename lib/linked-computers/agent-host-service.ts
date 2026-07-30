import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { isMarketplaceAgentId, marketplacePolicyVersion } from '@/lib/agents/marketplace'
import { AGENT_SKILL_POLICY, getAgentSkillPolicy } from '@/lib/agents/skill-policy'
import { buildSkillPackManifest } from '@/lib/agents/skill-pack-builder'
import { listAgents } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import {
  applyBindingJobProgress,
  bindingsNeedingInstall,
  bindingsNeedingPolicySync,
  mergeDesiredAgentBindings,
  parseDesiredAgentBindings,
  type DesiredAgentBinding,
  type DesiredAgentInput,
} from './agent-bindings'
import {
  allocatePreferredAgentPort,
  listPullableAgentIds,
  resolvePreferredAgentPort,
} from './agent-host-ports'
import type { AgentHostJob, AgentHostJobPayload } from './agent-jobs'
import { enqueueAgentHostJob } from './agent-job-store'
import {
  assertDeviceManager,
  isActiveOrgMembershipRow,
  linkedDeviceActorUserId,
  linkedDeviceOwnerType,
} from './policy'
import type { LinkedDevice } from './types'
import { memberCanUseAgentOnRuntime, resolveMemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { canPullAgentToDevice } from '@/lib/agents/org-agent-policy'

const DEVICES = 'linked_devices'
const MEMBERS = 'orgMembers'
const AGENT_HOST_PROTOCOL_VERSION = 3

async function reservePreferredAgentPort(deviceId: string, agentId: AgentId): Promise<number> {
  const managedPort = resolvePreferredAgentPort(agentId)
  if (managedPort < 8800) return managedPort
  const deviceRef = adminDb.collection(DEVICES).doc(deviceId)
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(deviceRef)
    if (!snapshot.exists) throw new Error('linked computers: device not found')
    const rawAssignments = snapshot.data()?.agentPortAssignments
    const assignments: Record<string, number> = rawAssignments
      && typeof rawAssignments === 'object'
      && !Array.isArray(rawAssignments)
      ? Object.fromEntries(Object.entries(rawAssignments as Record<string, unknown>)
          .flatMap(([key, value]) => typeof value === 'number' ? [[key, value]] : []))
      : {}
    const port = allocatePreferredAgentPort(agentId, assignments)
    if (assignments[agentId] !== port) {
      transaction.update(deviceRef, {
        // Agent IDs may contain dots, so write the map as a value instead of
        // letting Firestore interpret an ID as a nested field path.
        agentPortAssignments: { ...assignments, [agentId]: port },
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    return port
  })
}

function skillPackForAgent(agentId: AgentId): AgentHostJobPayload['skillPack'] {
  const policy = getAgentSkillPolicy(agentId)
  const manifest = buildSkillPackManifest(agentId)
  const marketplace = isMarketplaceAgentId(agentId)
  // Managed / marketplace agents must ship real skills; custom agents may stamp an empty pack.
  if ((policy || marketplace) && manifest.skillNames.length === 0) {
    throw new Error(`agent-host: agent ${agentId} has an empty skill pack`)
  }
  return {
    packSha256: manifest.packSha256,
    policyVersion: manifest.policyVersion,
    skillNames: manifest.skillNames,
    artifactPath: `/api/v1/linked-computers/{deviceId}/agents/skills/artifact?agentId=${encodeURIComponent(agentId)}&packSha256=${manifest.packSha256}`,
  }
}

async function policyPayload(agentId: AgentId, keepInSync: boolean, deviceId?: string): Promise<AgentHostJobPayload> {
  const policy = getAgentSkillPolicy(agentId)
  const agent = (await listAgents()).find((row) => row.agentId === agentId)
  const isMarketplace = agent?.agentKind === 'marketplace'
    || Boolean(agent?.marketplaceTemplateId)
    || isMarketplaceAgentId(agentId)
  const effectiveKeepInSync = keepInSync === true
  // Marketplace instances always ship the public pack (never empty / never full PiB ops).
  // Managed agents ship full policy packs. Custom agents only pack when keep-in-sync.
  const skillPack = (effectiveKeepInSync || policy || isMarketplace)
    ? skillPackForAgent(agentId)
    : null
  if (effectiveKeepInSync && !skillPack) {
    throw new Error(`agent-host: skill pack required for keep-in-sync on ${agentId}`)
  }
  const artifactPath = skillPack
    ? skillPack.artifactPath.replace('{deviceId}', deviceId ?? '{deviceId}')
    : null
  const policyVersion = skillPack?.policyVersion
    ?? (policy ? AGENT_SKILL_POLICY.version : null)

  // Marketplace: runtimeSkills = public skills only; pibSkills intentionally empty.
  const marketplaceSkills = isMarketplace ? (skillPack?.skillNames ?? []) : null

  return {
    agentId,
    policyVersion,
    keepInSync: effectiveKeepInSync || isMarketplace,
    runtimeSkills: marketplaceSkills ?? policy?.runtimeSkills ?? [],
    pibSkills: isMarketplace ? [] : (policy?.pibSkills ?? []),
    vpsExternalDir: isMarketplace
      ? null
      : (policy?.vpsExternalDir ?? null),
    preferredPort: deviceId
      ? await reservePreferredAgentPort(deviceId, agentId)
      : resolvePreferredAgentPort(agentId),
    ...(agent?.provisioningMode === 'linked_device' ? {
      profileConfig: {
        name: agent.name,
        role: agent.role,
        persona: agent.persona,
        defaultModel: agent.defaultModel,
      },
    } : {}),
    protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
    ...(skillPack && artifactPath
      ? { skillPack: { ...skillPack, artifactPath } }
      : {}),
  }
}

function jobIdempotencyKey(
  kind: 'install' | 'sync-policy' | 'uninstall',
  deviceId: string,
  agentId: string,
  policyVersion: string | null,
  packSha256?: string | null,
): string {
  const pack = packSha256 ? packSha256.slice(0, 16) : 'nopack'
  return `${kind}:${deviceId}:${agentId}:${policyVersion ?? 'none'}:${pack}`
}

async function authorizedCatalogForDevice(input: {
  actorUserId: string
  orgId: string
  device: LinkedDevice
}): Promise<AgentId[]> {
  const membership = await adminDb.collection(MEMBERS).doc(`${input.orgId}_${input.actorUserId}`).get()
  const membershipRow = membership.data()
  const membershipActive = membership.exists
    && isActiveOrgMembershipRow(membershipRow)
    && membershipRow?.orgId === input.orgId
  if (!membershipActive) throw new Error('linked computers: active membership required')
  const membershipRole = typeof membershipRow?.role === 'string' ? membershipRow.role : ''
  const orgManager = membershipRole === 'owner' || membershipRole === 'admin'
  const ownerType = linkedDeviceOwnerType(input.device)
  if (ownerType === 'user' && input.device.ownerUserId !== input.actorUserId) {
    throw new Error('linked computers: device owner required')
  }
  if (ownerType === 'organization' && (!orgManager || input.device.ownerOrgId !== input.orgId)) {
    throw new Error('linked computers: organisation administrator required')
  }

  const runtimeTargetId = input.device.runtimeTargetId || `linked-device:${input.device.deviceId}`
  const accessPolicy = resolveMemberAccessPolicy({
    role: membershipRole as 'owner' | 'admin' | 'member' | 'viewer',
    accessScope: membershipRow?.accessScope,
    accessPolicy: membershipRow?.accessPolicy,
  })
  const agents = await listAgents()
  return agents
    .filter((agent) => canPullAgentToDevice({
      agent,
      actorUserId: input.actorUserId,
      orgId: input.orgId,
      orgManager,
      explicitlyGranted: memberCanUseAgentOnRuntime(accessPolicy, runtimeTargetId, agent.agentId),
    }))
    .map((agent) => agent.agentId)
    .sort() as AgentId[]
}

export async function listCatalogAgentIds(input?: {
  actorUserId: string
  orgId: string
  deviceId: string
}): Promise<AgentId[]> {
  if (input) {
    const deviceDoc = await adminDb.collection(DEVICES).doc(input.deviceId).get()
    if (!deviceDoc.exists) throw new Error('linked computers: device not found')
    return authorizedCatalogForDevice({
      actorUserId: input.actorUserId,
      orgId: input.orgId,
      device: { deviceId: input.deviceId, ...deviceDoc.data() } as LinkedDevice,
    })
  }
  return listPullableAgentIds(async () => {
    const agents = await listAgents()
    return agents
      .filter((agent) => !agent.scopeOrgId)
      .map((agent) => ({ agentId: agent.agentId, enabled: agent.enabled !== false }))
  })
}

export async function listDeviceDesiredAgents(deviceId: string): Promise<{
  deviceId: string
  availableAgentIds: string[]
  desiredAgents: DesiredAgentBinding[]
}> {
  const snapshot = await adminDb.collection(DEVICES).doc(deviceId).get()
  if (!snapshot.exists) throw new Error('linked computers: device not found')
  const device = snapshot.data() as LinkedDevice & { desiredAgents?: unknown }
  const availableAgentIds = Array.isArray(device.availableAgentIds)
    ? device.availableAgentIds.filter((id): id is string => typeof id === 'string')
    : []
  return {
    deviceId,
    availableAgentIds,
    desiredAgents: parseDesiredAgentBindings(device.desiredAgents),
  }
}

async function resolveOrgIdForDevice(device: LinkedDevice & { desiredAgents?: unknown }, deviceId: string): Promise<string> {
  if (linkedDeviceOwnerType(device) === 'organization') return String(device.ownerOrgId)
  const grants = await adminDb.collection('linked_device_grants')
    .where('deviceId', '==', deviceId)
    .where('status', '==', 'active')
    .limit(1)
    .get()
  return grants.docs[0]?.data()?.orgId ? String(grants.docs[0].data().orgId) : ''
}

export async function setDeviceDesiredAgents(input: {
  deviceId: string
  actorUserId: string
  orgId: string
  desired: DesiredAgentInput[]
  enqueueJobs?: boolean
}): Promise<{
  desiredAgents: DesiredAgentBinding[]
  enqueuedJobIds: string[]
}> {
  const deviceRef = adminDb.collection(DEVICES).doc(input.deviceId)
  const snapshot = await deviceRef.get()
  if (!snapshot.exists) throw new Error('linked computers: device not found')
  const device = snapshot.data() as LinkedDevice & { desiredAgents?: unknown }
  if (linkedDeviceOwnerType(device) === 'user') {
    assertDeviceManager({ actorUserId: input.actorUserId, device })
  } else {
    const ownerOrgId = String(device.ownerOrgId)
    const membershipSnap = await adminDb.collection(MEMBERS).doc(`${ownerOrgId}_${input.actorUserId}`).get()
    const membershipRow = membershipSnap.data()
    assertDeviceManager({
      actorUserId: input.actorUserId,
      device,
      ownerOrgMembership: {
        orgId: ownerOrgId,
        userId: input.actorUserId,
        active: isActiveOrgMembershipRow(membershipRow) && membershipRow?.orgId === ownerOrgId
          && (membershipRow.uid === input.actorUserId || membershipRow.userId === input.actorUserId),
        role: typeof membershipRow?.role === 'string' ? membershipRow.role : undefined,
      },
    })
  }

  const catalog = new Set(await authorizedCatalogForDevice({
    actorUserId: input.actorUserId,
    orgId: input.orgId,
    device: { ...device, deviceId: input.deviceId } as LinkedDevice,
  }))
  const rejectedAgentIds = input.desired
    .map((row) => row.agentId)
    .filter((agentId) => !catalog.has(agentId))
  if (rejectedAgentIds.length > 0) {
    throw new Error(`agent-host: agent access denied (${Array.from(new Set(rejectedAgentIds)).join(', ')})`)
  }
  const filteredDesired = input.desired
    .filter((row) => catalog.has(row.agentId))
    .map((row) => ({
      agentId: row.agentId,
      keepInSync: row.keepInSync === true,
    }))

  const existing = parseDesiredAgentBindings(device.desiredAgents)
  const policyVersionByAgent: Record<string, string | null> = {}
  for (const row of filteredDesired) {
    if (!isValidAgentId(row.agentId)) continue
    // Keep-in-sync stamps catalog policy version even for empty custom packs.
    // Marketplace instances use the public pack version (never full PiB policy).
    if (isMarketplaceAgentId(row.agentId)) {
      policyVersionByAgent[row.agentId] = marketplacePolicyVersion()
      continue
    }
    policyVersionByAgent[row.agentId] = row.keepInSync || getAgentSkillPolicy(row.agentId)
      ? AGENT_SKILL_POLICY.version
      : null
  }
  const merged = mergeDesiredAgentBindings({
    existing,
    desired: filteredDesired,
    policyVersionByAgent,
  })

  await deviceRef.update({
    desiredAgents: merged.bindings,
    updatedAt: FieldValue.serverTimestamp(),
  })

  const enqueuedJobIds: string[] = []
  if (input.enqueueJobs !== false) {
    for (const agentId of merged.removed) {
      const payload = await policyPayload(agentId, false, input.deviceId)
      const job = await enqueueAgentHostJob({
        idempotencyKey: jobIdempotencyKey('uninstall', input.deviceId, agentId, payload.policyVersion, payload.skillPack?.packSha256),
        deviceId: input.deviceId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        credentialVersion: device.credentialVersion,
        kind: 'uninstall',
        payload,
      })
      enqueuedJobIds.push(job.jobId)
    }

    const availableAgentIds = Array.isArray(device.availableAgentIds)
      ? device.availableAgentIds.filter((id): id is string => typeof id === 'string')
      : []
    const installTargets = bindingsNeedingInstall({
      bindings: merged.bindings.filter((binding) => merged.added.includes(binding.agentId) || availableAgentIds.indexOf(binding.agentId) < 0),
      availableAgentIds,
    })
    for (const binding of installTargets) {
      const payload = await policyPayload(binding.agentId, binding.keepInSync, input.deviceId)
      const job = await enqueueAgentHostJob({
        idempotencyKey: jobIdempotencyKey('install', input.deviceId, binding.agentId, binding.desiredPolicyVersion, payload.skillPack?.packSha256),
        deviceId: input.deviceId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        credentialVersion: device.credentialVersion,
        kind: 'install',
        payload,
      })
      enqueuedJobIds.push(job.jobId)
      await patchDesiredAgentBinding(input.deviceId, binding.agentId, {
        status: 'installing',
        lastError: null,
      })
    }

    const syncTargets = bindingsNeedingPolicySync({
      bindings: merged.bindings.filter((binding) => (
        binding.keepInSync
        && (merged.added.includes(binding.agentId)
          || merged.keepInSyncChanged.includes(binding.agentId)
          || binding.status === 'drifted')
      )),
      availableAgentIds,
    })
    for (const binding of syncTargets) {
      if (installTargets.some((row) => row.agentId === binding.agentId)) continue
      const payload = await policyPayload(binding.agentId, binding.keepInSync, input.deviceId)
      const job = await enqueueAgentHostJob({
        idempotencyKey: jobIdempotencyKey('sync-policy', input.deviceId, binding.agentId, binding.desiredPolicyVersion, payload.skillPack?.packSha256),
        deviceId: input.deviceId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        credentialVersion: device.credentialVersion,
        kind: 'sync-policy',
        payload,
      })
      enqueuedJobIds.push(job.jobId)
      await patchDesiredAgentBinding(input.deviceId, binding.agentId, {
        status: 'syncing',
        lastError: null,
      })
    }
  }

  const refreshed = await listDeviceDesiredAgents(input.deviceId)
  return { desiredAgents: refreshed.desiredAgents, enqueuedJobIds }
}

export async function patchDesiredAgentBinding(
  deviceId: string,
  agentId: AgentId,
  update: Parameters<typeof applyBindingJobProgress>[1],
): Promise<DesiredAgentBinding | null> {
  const deviceRef = adminDb.collection(DEVICES).doc(deviceId)
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(deviceRef)
    if (!snapshot.exists) throw new Error('linked computers: device not found')
    const device = snapshot.data() as LinkedDevice & { desiredAgents?: unknown }
    const bindings = parseDesiredAgentBindings(device.desiredAgents)
    const index = bindings.findIndex((binding) => binding.agentId === agentId)
    if (index < 0) return null
    const next = [...bindings]
    next[index] = applyBindingJobProgress(bindings[index], update)
    transaction.update(deviceRef, {
      desiredAgents: next,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return next[index]
  })
}

function resultFlag(result: Record<string, unknown> | undefined, key: string): boolean {
  return result?.[key] === true
}

export async function finalizeLinkedAgentProvisioning(input: {
  agent: import('@/lib/agents/types').AgentTeamStoredDoc
  deviceId: string
}): Promise<{ ready: boolean; error: string | null }> {
  const { agent, deviceId } = input
  const agentRef = adminDb.collection('agent_team').doc(agent.agentId)
  const deviceRef = adminDb.collection(DEVICES).doc(deviceId)
  const isHomeDevice = agent.homeDeviceId === deviceId
  try {
    // A signed, healthy install receipt is authoritative enough to expose this
    // profile as a credential-sync target before the next device heartbeat.
    await deviceRef.update({
      availableAgentIds: FieldValue.arrayUnion(agent.agentId),
      updatedAt: FieldValue.serverTimestamp(),
    })

    const deviceDoc = await deviceRef.get()
    const device = deviceDoc.data() as LinkedDevice | undefined
    const deviceOwnerType = device ? linkedDeviceOwnerType(device) : null
    const ownerUid = deviceOwnerType === 'user'
      ? device?.ownerUserId
      : agent.ownerUserId || agent.createdByUserId
    if (!ownerUid || !agent.scopeOrgId) {
      throw new Error('Agent owner or organisation is missing')
    }
    const [{ listLlmProviderConnections }, { syncLlmConnectionToHermes }] = await Promise.all([
      import('@/lib/llm-providers/store'),
      import('@/lib/llm-providers/sync-hermes'),
    ])
    const connections = (await listLlmProviderConnections({
      orgId: agent.scopeOrgId,
      uid: ownerUid,
    })).filter((connection) => connection.status === 'connected'
      && connection.hasCredentials
      && (deviceOwnerType === 'user' ? connection.scope === 'user' : agent.accessScope === 'organization' || connection.scope === 'user'))

    if (!connections.length) {
      throw new Error('Connect an LLM provider, then retry this agent')
    }

    let synced = false
    let deliveryQueued = false
    const errors: string[] = []
    for (const connection of connections) {
      try {
        const result = await syncLlmConnectionToHermes(connection.id, {
          agentIds: [agent.agentId],
        })
        synced = synced || result.synced.includes(agent.agentId)
        deliveryQueued = deliveryQueued || result.queued.some((queued) => queued.agentId === agent.agentId)
        errors.push(...result.failed.map((failure) => failure.error))
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Provider sync failed')
      }
    }
    if (!synced && !deliveryQueued) {
      throw new Error(errors[0] || 'No connected provider could be synced to this agent')
    }

    if (!synced) {
      if (isHomeDevice) {
        await agentRef.update({
          provisioningStatus: 'installing',
          provisioningError: null,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      return { ready: false, error: null }
    }
    if (synced) {
      await deviceRef.update({
        credentialReadyAgentIds: FieldValue.arrayUnion(agent.agentId),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    if (isHomeDevice) {
      await agentRef.update({
        provisioningStatus: 'ready',
        provisioningError: null,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    return { ready: true, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Agent provider setup failed'
    await deviceRef.update({
      credentialReadyAgentIds: FieldValue.arrayRemove(agent.agentId),
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined)
    if (isHomeDevice) {
      await agentRef.update({
        provisioningStatus: 'failed',
        provisioningError: message,
        updatedAt: FieldValue.serverTimestamp(),
      }).catch(() => undefined)
    }
    return { ready: false, error: message }
  }
}

export async function applyAgentHostJobResult(job: AgentHostJob): Promise<void> {
  const agentId = job.payload.agentId
  if (job.kind === 'sync-credential' || job.kind === 'revoke-credential') {
    const delivery = job.payload.credentialDelivery
    if (!delivery) return
    const {
      requireDeliverableLlmCredentialBinding,
      requireMatchingLlmCredentialBindingGeneration,
      updateLlmCredentialBinding,
    } = await import('@/lib/llm-providers/bindings')
    if (job.kind === 'revoke-credential') {
      try {
        await requireMatchingLlmCredentialBindingGeneration({
          bindingId: delivery.bindingId,
          connectionId: delivery.connectionId,
          credentialVersion: delivery.credentialVersion,
          deviceId: job.deviceId,
          ownerUid: delivery.connectionId.startsWith('user:') ? job.actorUserId : null,
          orgId: job.orgId,
          scope: delivery.connectionId.startsWith('user:') ? 'user' : 'org',
          agentId,
        })
      } catch {
        // A newer OAuth generation superseded this old revoke receipt.
        return
      }
      await updateLlmCredentialBinding(delivery.bindingId, {
        status: 'revoked',
        liveAuthVerified: false,
        verifiedModelIds: [],
        lastError: null,
      })
      return
    }
    try {
      await requireDeliverableLlmCredentialBinding({
        bindingId: delivery.bindingId,
        connectionId: delivery.connectionId,
        credentialVersion: delivery.credentialVersion,
        deviceId: job.deviceId,
        ownerUid: delivery.connectionId.startsWith('user:') ? job.actorUserId : null,
        orgId: job.orgId,
        scope: delivery.connectionId.startsWith('user:') ? 'user' : 'org',
        agentId,
      })
    } catch {
      // A newer credential generation or revocation superseded this receipt.
      return
    }
    const ready = job.status === 'completed' && resultFlag(job.result, 'liveAuthVerified')
    const modelIds = Array.isArray(job.result?.modelIds)
      ? job.result.modelIds.filter((value): value is string => typeof value === 'string')
      : []
    await updateLlmCredentialBinding(delivery.bindingId, {
      status: ready ? 'ready' : 'failed',
      liveAuthVerified: ready,
      verifiedModelIds: ready ? modelIds : [],
      lastError: ready ? null : (job.error ?? 'Live provider authentication failed'),
      deliveryJobId: job.jobId,
    })
    if (ready) {
      await adminDb.collection(DEVICES).doc(job.deviceId).update({
        credentialReadyAgentIds: FieldValue.arrayUnion(agentId),
        updatedAt: FieldValue.serverTimestamp(),
      })
      const agentRef = adminDb.collection('agent_team').doc(agentId)
      const agentDoc = await agentRef.get()
      if (agentDoc.data()?.provisioningMode === 'linked_device'
        && agentDoc.data()?.homeDeviceId === job.deviceId) {
        await agentRef.update({
          provisioningStatus: 'ready',
          provisioningError: null,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    }
    return
  }
  if (job.kind === 'uninstall') {
    // Binding was already removed from desiredAgents; nothing to patch.
    return
  }
  if (job.status === 'completed') {
    const healthy = resultFlag(job.result, 'healthy')
    const skillsApplied = resultFlag(job.result, 'skillsApplied')
    const policyApplied = resultFlag(job.result, 'policyApplied')
    const requiredSkills = Boolean(job.payload.skillPack) && (job.payload.keepInSync || job.kind === 'sync-policy')
    const inSync = Boolean(
      job.payload.keepInSync
      && job.payload.policyVersion
      && policyApplied
      && (!requiredSkills || skillsApplied)
      && (job.kind !== 'install' || healthy),
    )

    if (job.kind === 'install') {
      await patchDesiredAgentBinding(job.deviceId, agentId, {
        status: inSync ? 'in_sync' : (healthy ? 'installed' : 'error'),
        appliedPolicyVersion: inSync || policyApplied ? job.payload.policyVersion : null,
        desiredPolicyVersion: job.payload.policyVersion,
        lastError: healthy ? null : 'Agent installed but not yet healthy on the host',
      })
      const agentRef = adminDb.collection('agent_team').doc(agentId)
      const agentDoc = await agentRef.get()
      const agent = agentDoc.data() as import('@/lib/agents/types').AgentTeamStoredDoc | undefined
      if (agent?.provisioningMode === 'linked_device') {
        if (healthy) {
          await finalizeLinkedAgentProvisioning({ agent, deviceId: job.deviceId })
        } else if (agent.homeDeviceId === job.deviceId) {
          await agentRef.update({
            provisioningStatus: 'failed',
            provisioningError: 'Agent installed but did not become healthy',
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }
      return
    }

    await patchDesiredAgentBinding(job.deviceId, agentId, {
      status: inSync ? 'in_sync' : 'drifted',
      appliedPolicyVersion: inSync ? job.payload.policyVersion : null,
      desiredPolicyVersion: job.payload.policyVersion,
      lastError: inSync ? null : 'Policy sync completed without a healthy in-sync receipt',
    })
    return
  }
  if (job.status === 'failed') {
    await patchDesiredAgentBinding(job.deviceId, agentId, {
      status: 'error',
      lastError: job.error ?? 'Agent host job failed',
    })
    const agentRef = adminDb.collection('agent_team').doc(agentId)
    const agentDoc = await agentRef.get()
    if (job.kind === 'install'
      && agentDoc.data()?.provisioningMode === 'linked_device'
      && agentDoc.data()?.homeDeviceId === job.deviceId) {
      await agentRef.update({
        provisioningStatus: 'failed',
        provisioningError: job.error ?? 'Agent host job failed',
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  }
}

/**
 * Push an updated custom-agent profile (SOUL / persona / model label) to every
 * active device that still hosts or desires this agent.
 *
 * Uses a profile-revision-scoped idempotency key so identity edits re-run even
 * when the skill-policy version is unchanged.
 */
export async function enqueueLinkedAgentProfileSync(input: {
  agentId: AgentId
  actorUserId: string
  orgId: string
  profileRevision: string
}): Promise<string[]> {
  const snapshot = await adminDb.collection(DEVICES)
    .where('status', '==', 'active')
    .get()
  const jobIds: string[] = []
  const revision = input.profileRevision.trim().slice(0, 32) || 'latest'
  const policyVersionTag = `profile:${revision}`

  for (const doc of snapshot.docs) {
    const device = doc.data() as LinkedDevice & { desiredAgents?: unknown }
    const bindings = parseDesiredAgentBindings(device.desiredAgents)
    const binding = bindings.find((row) => row.agentId === input.agentId)
    const available = Array.isArray(device.availableAgentIds)
      ? device.availableAgentIds.filter((id): id is string => typeof id === 'string')
      : []
    if (!binding && !available.includes(input.agentId)) continue

    const resolvedOrgId = await resolveOrgIdForDevice(device, doc.id)
    if (!resolvedOrgId || resolvedOrgId !== input.orgId) continue

    if (binding) {
      await patchDesiredAgentBinding(doc.id, input.agentId, {
        status: 'syncing',
        lastError: null,
      })
    }

    const payload = await policyPayload(input.agentId, binding?.keepInSync === true, doc.id)
    const job = await enqueueAgentHostJob({
      idempotencyKey: `sync-policy:profile:${doc.id}:${input.agentId}:${revision}`,
      deviceId: doc.id,
      orgId: resolvedOrgId,
      actorUserId: input.actorUserId || linkedDeviceActorUserId(device),
      credentialVersion: device.credentialVersion,
      kind: 'sync-policy',
      payload: {
        ...payload,
        // Keep skill pack behaviour; revision only de-dupes host jobs.
        policyVersion: payload.policyVersion ?? policyVersionTag,
      },
    })
    jobIds.push(job.jobId)
  }
  return jobIds
}

/** Enqueue sync-policy jobs for every linked device that hosts this agent with keepInSync. */
export async function enqueueKeepInSyncPolicyJobs(input: {
  agentId: AgentId
  actorUserId: string
  policyVersion: string
}): Promise<string[]> {
  const snapshot = await adminDb.collection(DEVICES)
    .where('status', '==', 'active')
    .get()
  const jobIds: string[] = []
  for (const doc of snapshot.docs) {
    const device = doc.data() as LinkedDevice & { desiredAgents?: unknown }
    const bindings = parseDesiredAgentBindings(device.desiredAgents)
    const binding = bindings.find((row) => row.agentId === input.agentId && row.keepInSync)
    if (!binding) continue
    const resolvedOrgId = await resolveOrgIdForDevice(device, doc.id)
    if (!resolvedOrgId) continue

    await patchDesiredAgentBinding(doc.id, input.agentId, {
      status: 'drifted',
      desiredPolicyVersion: input.policyVersion,
      lastError: null,
    })
    const payload = await policyPayload(input.agentId, true, doc.id)
    const job = await enqueueAgentHostJob({
      idempotencyKey: jobIdempotencyKey('sync-policy', doc.id, input.agentId, input.policyVersion, payload.skillPack?.packSha256),
      deviceId: doc.id,
      orgId: resolvedOrgId,
      actorUserId: input.actorUserId || linkedDeviceActorUserId(device),
      credentialVersion: device.credentialVersion,
      kind: 'sync-policy',
      payload: {
        ...payload,
        policyVersion: input.policyVersion,
      },
    })
    jobIds.push(job.jobId)
    await patchDesiredAgentBinding(doc.id, input.agentId, {
      status: 'syncing',
      desiredPolicyVersion: input.policyVersion,
      lastError: null,
    })
  }
  return jobIds
}

/** After heartbeat, requeue missing installs and keep-in-sync policy drift. */
export async function reconcileDesiredAgentsAfterHeartbeat(input: {
  deviceId: string
  availableAgentIds: string[]
}): Promise<string[]> {
  const snapshot = await adminDb.collection(DEVICES).doc(input.deviceId).get()
  if (!snapshot.exists) return []
  const device = snapshot.data() as LinkedDevice & { desiredAgents?: unknown }
  const bindings = parseDesiredAgentBindings(device.desiredAgents)
  const orgId = await resolveOrgIdForDevice(device, input.deviceId)
  if (!orgId) return []

  const jobIds: string[] = []

  const missing = bindingsNeedingInstall({
    bindings: bindings.filter((binding) => binding.keepInSync || binding.status === 'desired' || binding.status === 'installing' || binding.status === 'error'),
    availableAgentIds: input.availableAgentIds,
  })
  for (const binding of missing) {
    if (binding.status === 'installing' && Date.now() - binding.updatedAtMs < 120_000) continue
    const payload = await policyPayload(binding.agentId, binding.keepInSync, input.deviceId)
    const job = await enqueueAgentHostJob({
      idempotencyKey: jobIdempotencyKey('install', input.deviceId, binding.agentId, binding.desiredPolicyVersion, payload.skillPack?.packSha256),
      deviceId: input.deviceId,
      orgId,
      actorUserId: linkedDeviceActorUserId(device),
      credentialVersion: device.credentialVersion,
      kind: 'install',
      payload,
    })
    jobIds.push(job.jobId)
    await patchDesiredAgentBinding(input.deviceId, binding.agentId, {
      status: 'installing',
      lastError: null,
    })
  }

  // Online hosts with keep-in-sync but version drift get a sync-policy job.
  const driftTargets = bindings.filter((binding) => (
    binding.keepInSync
    && input.availableAgentIds.includes(binding.agentId)
    && binding.desiredPolicyVersion
    && binding.desiredPolicyVersion !== binding.appliedPolicyVersion
    && binding.status !== 'syncing'
    && binding.status !== 'installing'
  ))
  for (const binding of driftTargets) {
    if (Date.now() - binding.updatedAtMs < 120_000 && binding.status === 'drifted') continue
    await patchDesiredAgentBinding(input.deviceId, binding.agentId, {
      status: 'drifted',
      desiredPolicyVersion: binding.desiredPolicyVersion,
      lastError: null,
    })
    const payload = await policyPayload(binding.agentId, true, input.deviceId)
    const job = await enqueueAgentHostJob({
      idempotencyKey: jobIdempotencyKey('sync-policy', input.deviceId, binding.agentId, binding.desiredPolicyVersion, payload.skillPack?.packSha256),
      deviceId: input.deviceId,
      orgId,
      actorUserId: linkedDeviceActorUserId(device),
      credentialVersion: device.credentialVersion,
      kind: 'sync-policy',
      payload,
    })
    jobIds.push(job.jobId)
    await patchDesiredAgentBinding(input.deviceId, binding.agentId, {
      status: 'syncing',
      desiredPolicyVersion: binding.desiredPolicyVersion,
      lastError: null,
    })
  }

  return jobIds
}
