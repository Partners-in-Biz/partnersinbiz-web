import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  isMarketplaceAgentId,
  marketplacePolicyVersion,
  marketplacePolicyVersionForSkills,
  marketplacePublicSkillsForAgent,
} from '@/lib/agents/marketplace'
import { AGENT_SKILL_POLICY, getAgentSkillPolicy } from '@/lib/agents/skill-policy'
import { buildSkillPackManifest } from '@/lib/agents/skill-pack-builder'
import { listAgents } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import {
  applyBindingJobProgress,
  bindingPolicySyncBusyBackedOff,
  bindingSkillsDigestDrifted,
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
import { getOrgSlug } from '@/lib/organizations/slug'
import { getCanonicalModel } from '@/lib/llm-providers/model-registry'
import type { AgentHostJob, AgentHostJobPayload } from './agent-jobs'
import { catalogAgentIdFromPayload, preferredPortForAgent } from './agent-jobs'
import { enqueueAgentHostJob } from './agent-job-store'
import { managedProfileName, parseManagedProfileName } from './managed-profile'
import {
  assertDeviceManager,
  isActiveOrgMembershipRow,
  linkedDeviceActorUserId,
  linkedDeviceOwnerType,
} from './policy'
import type { LinkedAvailableProfile, LinkedDevice } from './types'
import { memberCanUseAgentOnRuntime, resolveMemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { canPullAgentToDevice } from '@/lib/agents/org-agent-policy'

const DEVICES = 'linked_devices'
const MEMBERS = 'orgMembers'
const AGENT_HOST_PROTOCOL_VERSION = 4

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

function skillPackForAgent(
  agentId: AgentId,
  options?: { skillNames?: string[] | null },
): AgentHostJobPayload['skillPack'] {
  const policy = getAgentSkillPolicy(agentId)
  const manifest = buildSkillPackManifest(agentId, options)
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

function modelDefaultFromAgent(defaultModel: string | undefined): AgentHostJobPayload['modelDefault'] {
  const id = typeof defaultModel === 'string' ? defaultModel.trim() : ''
  if (!id || id === 'auto') return null
  const canonical = getCanonicalModel(id)
  if (canonical) return { provider: canonical.provider, model: canonical.id }
  return { provider: 'custom', model: id }
}

async function policyPayload(
  catalogAgentId: AgentId,
  keepInSync: boolean,
  deviceId?: string,
  orgId?: string,
): Promise<AgentHostJobPayload> {
  const policy = getAgentSkillPolicy(catalogAgentId)
  const agent = (await listAgents()).find((row) => row.agentId === catalogAgentId)
  const isMarketplace = agent?.agentKind === 'marketplace'
    || Boolean(agent?.marketplaceTemplateId)
    || isMarketplaceAgentId(catalogAgentId)
  const marketplaceSkillOverride = isMarketplace && Array.isArray((agent as { marketplaceSkills?: unknown } | undefined)?.marketplaceSkills)
    ? ((agent as { marketplaceSkills?: string[] }).marketplaceSkills ?? null)
    : null
  const effectiveKeepInSync = keepInSync === true
  // Marketplace instances always ship the public pack (never empty / never full PiB ops).
  // Managed agents ship full policy packs. Custom agents only pack when keep-in-sync.
  const skillPack = (effectiveKeepInSync || policy || isMarketplace)
    ? skillPackForAgent(catalogAgentId, { skillNames: marketplaceSkillOverride })
    : null
  if (effectiveKeepInSync && !skillPack) {
    throw new Error(`agent-host: skill pack required for keep-in-sync on ${catalogAgentId}`)
  }
  const artifactPath = skillPack
    ? skillPack.artifactPath.replace('{deviceId}', deviceId ?? '{deviceId}')
    : null
  const policyVersion = skillPack?.policyVersion
    ?? (policy ? AGENT_SKILL_POLICY.version : null)

  // Marketplace: runtimeSkills = public skills only; pibSkills intentionally empty.
  const marketplaceSkills = isMarketplace ? (skillPack?.skillNames ?? []) : null

  const managed = orgId
    ? await (async () => {
        const orgSlug = await getOrgSlug(orgId)
        const profile = managedProfileName(orgSlug, catalogAgentId)
        return {
          agentId: profile,
          catalogAgentId,
          managedProfile: {
            orgId,
            orgSlug,
            agentId: catalogAgentId,
            profile,
          },
          modelDefault: modelDefaultFromAgent(agent?.defaultModel),
          apiServer: { enable: true } as const,
          preferredPort: preferredPortForAgent(catalogAgentId)
            ?? (deviceId
              ? await reservePreferredAgentPort(deviceId, catalogAgentId)
              : resolvePreferredAgentPort(catalogAgentId)),
        }
      })()
    : null

  return {
    agentId: managed?.agentId ?? catalogAgentId,
    policyVersion,
    keepInSync: effectiveKeepInSync || isMarketplace,
    runtimeSkills: marketplaceSkills ?? policy?.runtimeSkills ?? [],
    pibSkills: isMarketplace ? [] : (policy?.pibSkills ?? []),
    vpsExternalDir: isMarketplace
      ? null
      : (policy?.vpsExternalDir ?? null),
    preferredPort: managed?.preferredPort ?? (deviceId
      ? await reservePreferredAgentPort(deviceId, catalogAgentId)
      : resolvePreferredAgentPort(catalogAgentId)),
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
    ...(managed ? {
      catalogAgentId: managed.catalogAgentId,
      managedProfile: managed.managedProfile,
      ...(managed.modelDefault ? { modelDefault: managed.modelDefault } : {}),
      apiServer: managed.apiServer,
    } : {}),
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
  const agentsById = new Map((await listAgents()).map((row) => [row.agentId, row]))
  for (const row of filteredDesired) {
    if (!isValidAgentId(row.agentId)) continue
    // Keep-in-sync stamps catalog policy version even for empty custom packs.
    // Marketplace instances use content-addressed public pack versions.
    if (isMarketplaceAgentId(row.agentId)) {
      const agent = agentsById.get(row.agentId) as { marketplaceSkills?: string[] } | undefined
      const skills = marketplacePublicSkillsForAgent(row.agentId, agent?.marketplaceSkills)
      policyVersionByAgent[row.agentId] = marketplacePolicyVersionForSkills(skills)
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
      const payload = await policyPayload(agentId, false, input.deviceId, input.orgId)
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
      const payload = await policyPayload(binding.agentId, binding.keepInSync, input.deviceId, input.orgId)
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
      const payload = await policyPayload(binding.agentId, binding.keepInSync, input.deviceId, input.orgId)
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
  const agentId = catalogAgentIdFromPayload(job.payload)
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

    const appliedSkillsDigest = typeof job.result?.skillsDigest === 'string' && job.result.skillsDigest
      ? job.result.skillsDigest
      : undefined

    if (job.kind === 'install') {
      await patchDesiredAgentBinding(job.deviceId, agentId, {
        status: inSync ? 'in_sync' : (healthy ? 'installed' : 'error'),
        appliedPolicyVersion: inSync || policyApplied ? job.payload.policyVersion : null,
        desiredPolicyVersion: job.payload.policyVersion,
        ...(appliedSkillsDigest ? { appliedSkillsDigest } : {}),
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
      ...(appliedSkillsDigest ? { appliedSkillsDigest } : {}),
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

    const payload = await policyPayload(input.agentId, binding?.keepInSync === true, doc.id, resolvedOrgId)
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
    const payload = await policyPayload(input.agentId, true, doc.id, resolvedOrgId)
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

function observedCatalogAgentIds(
  availableAgentIds: string[],
  availableProfiles?: LinkedAvailableProfile[],
): Set<string> {
  const observed = new Set<string>()
  for (const id of availableAgentIds) {
    observed.add(id)
    const parsed = parseManagedProfileName(id)
    if (parsed?.agentId) observed.add(parsed.agentId)
  }
  for (const profile of availableProfiles ?? []) {
    observed.add(profile.agentId)
    observed.add(profile.profile)
  }
  return observed
}

function observedSkillsDigest(
  binding: DesiredAgentBinding,
  availableProfiles?: LinkedAvailableProfile[],
): string | null {
  const match = (availableProfiles ?? []).find((profile) => (
    profile.agentId === binding.agentId || profile.profile === binding.agentId
  ))
  return match?.skillsDigest ?? null
}

/** After heartbeat, requeue missing installs and keep-in-sync policy drift. */
export async function reconcileDesiredAgentsAfterHeartbeat(input: {
  deviceId: string
  availableAgentIds: string[]
  availableProfiles?: LinkedAvailableProfile[]
}): Promise<string[]> {
  const snapshot = await adminDb.collection(DEVICES).doc(input.deviceId).get()
  if (!snapshot.exists) return []
  const device = snapshot.data() as LinkedDevice & { desiredAgents?: unknown }
  const bindings = parseDesiredAgentBindings(device.desiredAgents)
  const orgId = await resolveOrgIdForDevice(device, input.deviceId)
  if (!orgId) return []

  const jobIds: string[] = []
  const observedIds = [...observedCatalogAgentIds(input.availableAgentIds, input.availableProfiles)]

  const missing = bindingsNeedingInstall({
    bindings: bindings.filter((binding) => binding.keepInSync || binding.status === 'desired' || binding.status === 'installing' || binding.status === 'error'),
    availableAgentIds: observedIds,
  })
  for (const binding of missing) {
    if (binding.status === 'installing' && Date.now() - binding.updatedAtMs < 120_000) continue
    const payload = await policyPayload(binding.agentId, binding.keepInSync, input.deviceId, orgId)
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
  // A profile that is mid-run defers the reload, the job fails with a busy
  // error, and the binding lands in 'error'. Without a backoff the next
  // heartbeat re-enqueues the same job and the fleet keeps receiving new
  // restart intents for the busy profile — the restart-request storm. Once a
  // busy deferral has been recorded, hold off for a few minutes so the
  // profile can drain instead of hammering it every heartbeat.
  const observedIdSet = new Set(observedIds)
  const driftTargets = bindings.filter((binding) => {
    if (!binding.keepInSync || !observedIdSet.has(binding.agentId)) return false
    if (binding.status === 'syncing' || binding.status === 'installing') return false
    if (bindingPolicySyncBusyBackedOff(binding)) return false
    const policyDrift = Boolean(
      binding.desiredPolicyVersion
      && binding.desiredPolicyVersion !== binding.appliedPolicyVersion,
    )
    const hostDigest = observedSkillsDigest(binding, input.availableProfiles)
    const skillsDrift = bindingSkillsDigestDrifted(binding, hostDigest)
    return policyDrift || skillsDrift
  })
  for (const binding of driftTargets) {
    if (Date.now() - binding.updatedAtMs < 120_000 && binding.status === 'drifted') continue
    await patchDesiredAgentBinding(input.deviceId, binding.agentId, {
      status: 'drifted',
      desiredPolicyVersion: binding.desiredPolicyVersion,
      lastError: null,
    })
    const payload = await policyPayload(binding.agentId, true, input.deviceId, orgId)
    const hostDigest = observedSkillsDigest(binding, input.availableProfiles)
    const job = await enqueueAgentHostJob({
      idempotencyKey: jobIdempotencyKey(
        'sync-policy',
        input.deviceId,
        binding.agentId,
        binding.desiredPolicyVersion,
        hostDigest && hostDigest !== binding.appliedSkillsDigest
          ? `digest:${hostDigest}`
          : payload.skillPack?.packSha256,
      ),
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

export async function enqueueBrowserPolicyJobs(input: {
  deviceId: string
  orgId: string
  actorUserId: string
  browserPolicy: NonNullable<AgentHostJobPayload['browserPolicy']>
}, deps: {
  loadDevice?: () => Promise<(LinkedDevice & { desiredAgents?: unknown }) | null>
  policyPayload?: typeof policyPayload
  enqueueAgentHostJob?: typeof enqueueAgentHostJob
} = {}): Promise<string[]> {
  const device = deps.loadDevice
    ? await deps.loadDevice()
    : await adminDb.collection(DEVICES).doc(input.deviceId).get().then((snapshot) => (
      snapshot.exists ? snapshot.data() as LinkedDevice & { desiredAgents?: unknown } : null
    ))
  if (!device) throw new Error('linked computers: device not found')
  const bindings = parseDesiredAgentBindings(device.desiredAgents)
  const buildPolicy = deps.policyPayload ?? policyPayload
  const enqueue = deps.enqueueAgentHostJob ?? enqueueAgentHostJob
  const jobIds: string[] = []
  for (const binding of bindings) {
    const payload = await buildPolicy(binding.agentId, binding.keepInSync, input.deviceId, input.orgId)
    const nextPayload: AgentHostJobPayload = {
      ...payload,
      browserPolicy: input.browserPolicy,
    }
    const job = await enqueue({
      idempotencyKey: `browser-policy:${input.deviceId}:${nextPayload.agentId}:${input.browserPolicy.useRealProfile}:${input.browserPolicy.realProfilePin ?? ''}:${input.browserPolicy.headed}:${input.browserPolicy.autoclose}`,
      deviceId: input.deviceId,
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      credentialVersion: device.credentialVersion,
      kind: 'sync-policy',
      payload: nextPayload,
    })
    jobIds.push(job.jobId)
  }
  return jobIds
}
