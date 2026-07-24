import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { AGENT_SKILL_POLICY, getAgentSkillPolicy } from '@/lib/agents/skill-policy'
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
import { preferredPortForAgent, type AgentHostJob } from './agent-jobs'
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

function policyPayload(agentId: AgentId, keepInSync: boolean) {
  const policy = getAgentSkillPolicy(agentId)
  return {
    agentId,
    policyVersion: AGENT_SKILL_POLICY.version,
    keepInSync,
    runtimeSkills: policy?.runtimeSkills ?? [],
    pibSkills: policy?.pibSkills ?? [],
    vpsExternalDir: policy?.vpsExternalDir ?? null,
    preferredPort: preferredPortForAgent(agentId),
  }
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

  const existing = parseDesiredAgentBindings(device.desiredAgents)
  const policyVersionByAgent: Record<string, string | null> = {}
  for (const row of input.desired) {
    if (!isValidAgentId(row.agentId)) continue
    policyVersionByAgent[row.agentId] = AGENT_SKILL_POLICY.version
  }
  const merged = mergeDesiredAgentBindings({
    existing,
    desired: input.desired,
    policyVersionByAgent,
  })

  await deviceRef.update({
    desiredAgents: merged.bindings,
    updatedAt: FieldValue.serverTimestamp(),
  })

  const enqueuedJobIds: string[] = []
  if (input.enqueueJobs !== false) {
    const availableAgentIds = Array.isArray(device.availableAgentIds)
      ? device.availableAgentIds.filter((id): id is string => typeof id === 'string')
      : []
    const installTargets = bindingsNeedingInstall({
      bindings: merged.bindings.filter((binding) => merged.added.includes(binding.agentId) || availableAgentIds.indexOf(binding.agentId) < 0),
      availableAgentIds,
    })
    for (const binding of installTargets) {
      const job = await enqueueAgentHostJob({
        idempotencyKey: `install:${input.deviceId}:${binding.agentId}:${binding.desiredPolicyVersion ?? 'none'}`,
        deviceId: input.deviceId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        credentialVersion: device.credentialVersion,
        kind: 'install',
        payload: policyPayload(binding.agentId, binding.keepInSync),
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
      const job = await enqueueAgentHostJob({
        idempotencyKey: `sync:${input.deviceId}:${binding.agentId}:${binding.desiredPolicyVersion ?? 'none'}`,
        deviceId: input.deviceId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        credentialVersion: device.credentialVersion,
        kind: 'sync-policy',
        payload: policyPayload(binding.agentId, binding.keepInSync),
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

export async function applyAgentHostJobResult(job: AgentHostJob): Promise<void> {
  const agentId = job.payload.agentId
  if (job.status === 'completed') {
    await patchDesiredAgentBinding(job.deviceId, agentId, {
      status: job.kind === 'install'
        ? (job.payload.keepInSync ? 'installed' : 'installed')
        : 'in_sync',
      appliedPolicyVersion: job.payload.policyVersion,
      desiredPolicyVersion: job.payload.policyVersion,
      lastError: null,
    })
    if (job.kind === 'install' && job.payload.keepInSync) {
      // Install stamps applied version when the worker also applied policy.
      const appliedPolicy = job.result?.policyApplied === true
      await patchDesiredAgentBinding(job.deviceId, agentId, {
        status: appliedPolicy ? 'in_sync' : 'installed',
        appliedPolicyVersion: appliedPolicy ? job.payload.policyVersion : null,
        lastError: null,
      })
    }
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
  const policy = getAgentSkillPolicy(input.agentId)
  const snapshot = await adminDb.collection(DEVICES)
    .where('status', '==', 'active')
    .get()
  const jobIds: string[] = []
  for (const doc of snapshot.docs) {
    const device = doc.data() as LinkedDevice & { desiredAgents?: unknown }
    const bindings = parseDesiredAgentBindings(device.desiredAgents)
    const binding = bindings.find((row) => row.agentId === input.agentId && row.keepInSync)
    if (!binding) continue
    const orgId = linkedDeviceOwnerType(device) === 'organization'
      ? String(device.ownerOrgId)
      : (Array.isArray((device as { grants?: unknown }).grants) ? '' : '')
    // Prefer first active grant org when personal device; fall back to owner org.
    let resolvedOrgId = orgId
    if (!resolvedOrgId) {
      const grants = await adminDb.collection('linked_device_grants')
        .where('deviceId', '==', doc.id)
        .where('status', '==', 'active')
        .limit(1)
        .get()
      resolvedOrgId = grants.docs[0]?.data()?.orgId
        ? String(grants.docs[0].data().orgId)
        : ''
    }
    if (!resolvedOrgId) continue

    await patchDesiredAgentBinding(doc.id, input.agentId, {
      status: 'drifted',
      desiredPolicyVersion: input.policyVersion,
      lastError: null,
    })
    const job = await enqueueAgentHostJob({
      idempotencyKey: `sync:${doc.id}:${input.agentId}:${input.policyVersion}`,
      deviceId: doc.id,
      orgId: resolvedOrgId,
      actorUserId: input.actorUserId || linkedDeviceActorUserId(device),
      credentialVersion: device.credentialVersion,
      kind: 'sync-policy',
      payload: {
        agentId: input.agentId,
        policyVersion: input.policyVersion,
        keepInSync: true,
        runtimeSkills: policy?.runtimeSkills ?? [],
        pibSkills: policy?.pibSkills ?? [],
        vpsExternalDir: policy?.vpsExternalDir ?? null,
        preferredPort: preferredPortForAgent(input.agentId),
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

/** After heartbeat, requeue missing keep-in-sync installs (at most once per agent/policy). */
export async function reconcileDesiredAgentsAfterHeartbeat(input: {
  deviceId: string
  availableAgentIds: string[]
}): Promise<string[]> {
  const snapshot = await adminDb.collection(DEVICES).doc(input.deviceId).get()
  if (!snapshot.exists) return []
  const device = snapshot.data() as LinkedDevice & { desiredAgents?: unknown }
  const bindings = parseDesiredAgentBindings(device.desiredAgents)
  const missing = bindingsNeedingInstall({
    bindings: bindings.filter((binding) => binding.keepInSync || binding.status === 'desired' || binding.status === 'installing' || binding.status === 'error'),
    availableAgentIds: input.availableAgentIds,
  })
  if (missing.length === 0) return []

  const grants = await adminDb.collection('linked_device_grants')
    .where('deviceId', '==', input.deviceId)
    .where('status', '==', 'active')
    .limit(1)
    .get()
  const orgId = grants.docs[0]?.data()?.orgId
    ? String(grants.docs[0].data().orgId)
    : (linkedDeviceOwnerType(device) === 'organization' ? String(device.ownerOrgId) : '')
  if (!orgId) return []

  const jobIds: string[] = []
  for (const binding of missing) {
    // Avoid hammering: skip if already marked installing recently (< 2 min).
    if (binding.status === 'installing' && Date.now() - binding.updatedAtMs < 120_000) continue
    const job = await enqueueAgentHostJob({
      idempotencyKey: `install:${input.deviceId}:${binding.agentId}:${binding.desiredPolicyVersion ?? 'none'}`,
      deviceId: input.deviceId,
      orgId,
      actorUserId: linkedDeviceActorUserId(device),
      credentialVersion: device.credentialVersion,
      kind: 'install',
      payload: policyPayload(binding.agentId, binding.keepInSync),
    })
    jobIds.push(job.jobId)
    await patchDesiredAgentBinding(input.deviceId, binding.agentId, {
      status: 'installing',
      lastError: null,
    })
  }
  return jobIds
}
