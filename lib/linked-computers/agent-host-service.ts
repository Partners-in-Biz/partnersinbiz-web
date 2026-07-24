import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
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
import { resolvePreferredAgentPort, listPullableAgentIds } from './agent-host-ports'
import type { AgentHostJob, AgentHostJobPayload } from './agent-jobs'
import { enqueueAgentHostJob } from './agent-job-store'
import {
  assertDeviceManager,
  isActiveOrgMembershipRow,
  linkedDeviceActorUserId,
  linkedDeviceOwnerType,
} from './policy'
import type { LinkedDevice } from './types'

const DEVICES = 'linked_devices'
const MEMBERS = 'orgMembers'
const AGENT_HOST_PROTOCOL_VERSION = 2

function skillPackForAgent(agentId: AgentId): AgentHostJobPayload['skillPack'] {
  const policy = getAgentSkillPolicy(agentId)
  if (!policy) return null
  const manifest = buildSkillPackManifest(agentId)
  if (manifest.skillNames.length === 0) {
    throw new Error(`agent-host: managed agent ${agentId} has an empty skill pack`)
  }
  return {
    packSha256: manifest.packSha256,
    policyVersion: manifest.policyVersion,
    skillNames: manifest.skillNames,
    artifactPath: `/api/v1/linked-computers/{deviceId}/agents/skills/artifact?agentId=${encodeURIComponent(agentId)}&packSha256=${manifest.packSha256}`,
  }
}

function policyPayload(agentId: AgentId, keepInSync: boolean, deviceId?: string): AgentHostJobPayload {
  const policy = getAgentSkillPolicy(agentId)
  // Custom agents may install without a pack; keep-in-sync requires a managed policy pack.
  const effectiveKeepInSync = keepInSync && Boolean(policy)
  const skillPack = effectiveKeepInSync || policy
    ? skillPackForAgent(agentId)
    : null
  if (policy && effectiveKeepInSync && !skillPack) {
    throw new Error(`agent-host: skill pack required for keep-in-sync on ${agentId}`)
  }
  const artifactPath = skillPack
    ? skillPack.artifactPath.replace('{deviceId}', deviceId ?? '{deviceId}')
    : null
  return {
    agentId,
    policyVersion: policy ? AGENT_SKILL_POLICY.version : null,
    keepInSync: effectiveKeepInSync,
    runtimeSkills: policy?.runtimeSkills ?? [],
    pibSkills: policy?.pibSkills ?? [],
    vpsExternalDir: policy?.vpsExternalDir ?? null,
    preferredPort: resolvePreferredAgentPort(agentId),
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

export async function listCatalogAgentIds(): Promise<AgentId[]> {
  return listPullableAgentIds(async () => {
    const agents = await listAgents()
    return agents.map((agent) => ({ agentId: agent.agentId, enabled: agent.enabled !== false }))
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

  const catalog = new Set(await listCatalogAgentIds())
  const filteredDesired = input.desired
    .filter((row) => catalog.has(row.agentId))
    .map((row) => ({
      agentId: row.agentId,
      // Keep-in-sync is only meaningful for managed skill-policy agents.
      keepInSync: row.keepInSync === true && Boolean(getAgentSkillPolicy(row.agentId)),
    }))

  const existing = parseDesiredAgentBindings(device.desiredAgents)
  const policyVersionByAgent: Record<string, string | null> = {}
  for (const row of filteredDesired) {
    if (!isValidAgentId(row.agentId)) continue
    policyVersionByAgent[row.agentId] = getAgentSkillPolicy(row.agentId)
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
      const payload = policyPayload(agentId, false, input.deviceId)
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
      const payload = policyPayload(binding.agentId, binding.keepInSync, input.deviceId)
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
      const payload = policyPayload(binding.agentId, binding.keepInSync, input.deviceId)
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

export async function applyAgentHostJobResult(job: AgentHostJob): Promise<void> {
  const agentId = job.payload.agentId
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
  }
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
    const payload = policyPayload(input.agentId, true, doc.id)
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
    const payload = policyPayload(binding.agentId, binding.keepInSync, input.deviceId)
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
    const payload = policyPayload(binding.agentId, true, input.deviceId)
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
