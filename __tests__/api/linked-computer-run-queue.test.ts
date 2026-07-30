import { NextRequest } from 'next/server'
import { handleLinkedRunClaim } from '@/app/api/v1/linked-computers/[deviceId]/runs/claim/route'
import { handleLinkedRunProgress } from '@/app/api/v1/linked-computers/[deviceId]/runs/[jobId]/progress/route'
import { handleLinkedRunComplete } from '@/app/api/v1/linked-computers/[deviceId]/runs/[jobId]/complete/route'
import {
  isLinkedRunCancellationBound,
  isLinkedRunClaimAuthorized,
  linkedRunQueueStartExpired,
} from '@/lib/linked-computers/run-queue-store'

const identity = { deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 3 }
const claim = { jobId: 'job-a', requestId: 'request-1234567890', prompt: 'do work', workspaceId: 'workspace-a', projectId: 'project-a', mappingId: 'mapping-a', relativeFolder: 'Projects/project-a' }

describe('linked computer outbound run routes', () => {
  it('expires only runs that never started inside the 45-minute capacity window', () => {
    const queueExpiresAtMs = Date.parse('2026-07-30T12:45:00Z')
    expect(linkedRunQueueStartExpired({ queueExpiresAtMs }, queueExpiresAtMs)).toBe(true)
    expect(linkedRunQueueStartExpired({
      queueExpiresAtMs,
      localHermesRunId: 'local-run-survives-restart',
    }, queueExpiresAtMs + 1)).toBe(false)
    expect(linkedRunQueueStartExpired({
      queueExpiresAtMs,
      acceptanceReceipt: {} as never,
    }, queueExpiresAtMs + 1)).toBe(false)
  })

  it('binds cancellation to the device, conversation, and assistant message that own the job', () => {
    const job = {
      jobId: 'job-a',
      deviceId: 'device-a',
      conversationId: 'conversation-a',
      assistantMessageId: 'message-a',
    }
    expect(isLinkedRunCancellationBound(job, {
      deviceId: 'device-a', conversationId: 'conversation-a', assistantMessageId: 'message-a',
    })).toBe(true)
    expect(isLinkedRunCancellationBound(job, {
      deviceId: 'device-b', conversationId: 'conversation-a', assistantMessageId: 'message-a',
    })).toBe(false)
    expect(isLinkedRunCancellationBound(job, {
      deviceId: 'device-a', conversationId: 'conversation-b', assistantMessageId: 'message-a',
    })).toBe(false)
    expect(isLinkedRunCancellationBound(job, {
      deviceId: 'device-a', conversationId: 'conversation-a', assistantMessageId: 'message-b',
    })).toBe(false)
  })

  it('reauthorizes organisation-wide jobs for an organisation-owned device without a creator membership fan-out', () => {
    expect(isLinkedRunClaimAuthorized({
      authenticatedDeviceUserId: 'creator-a',
      device: { deviceId: 'vps-a', ownerType: 'organization', ownerOrgId: 'org-a', createdByUserId: 'creator-a', status: 'active', credentialVersion: 3, capabilities: ['workspace.execute'] },
      grant: { deviceId: 'vps-a', orgId: 'org-a', status: 'active', accessMode: 'organization', allowedUserIds: [], capabilities: ['workspace.execute'] },
      mapping: { mappingId: 'map-a', deviceId: 'vps-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' },
      deviceMember: undefined,
      actorMember: { orgId: 'org-a', uid: 'future-member' },
      job: { deviceId: 'vps-a', orgId: 'org-a', actorUserId: 'future-member', workspaceId: 'workspace-a', mappingId: 'map-a' },
      credentialVersion: 3,
    })).toBe(true)
  })

  it('denies cross-organisation and unselected actors during queue claim reauthorization', () => {
    const base = {
      authenticatedDeviceUserId: 'owner-a',
      device: { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active', credentialVersion: 3, capabilities: ['workspace.execute'] },
      grant: { deviceId: 'device-a', orgId: 'org-a', status: 'active', accessMode: 'selected_users', allowedUserIds: ['selected-a'], capabilities: ['workspace.execute'] },
      mapping: { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' },
      deviceMember: { orgId: 'org-a', uid: 'owner-a' },
      actorMember: { orgId: 'org-a', uid: 'other-a' },
      job: { deviceId: 'device-a', orgId: 'org-a', actorUserId: 'other-a', workspaceId: 'workspace-a', mappingId: 'map-a' },
      credentialVersion: 3,
    }
    expect(isLinkedRunClaimAuthorized(base)).toBe(false)
    expect(isLinkedRunClaimAuthorized({ ...base, actorMember: { orgId: 'org-b', uid: 'selected-a' }, job: { ...base.job, orgId: 'org-b', actorUserId: 'selected-a' } })).toBe(false)
  })

  it('reauthorizes the immutable agent and delegation bindings on every claim', () => {
    const base = {
      authenticatedDeviceUserId: 'owner-a',
      device: { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active', credentialVersion: 3, capabilities: ['workspace.execute'], availableAgentIds: ['pip'] },
      grant: { deviceId: 'device-a', orgId: 'org-a', status: 'active', accessMode: 'selected_users', allowedUserIds: ['actor-a'], capabilities: ['workspace.execute'] },
      mapping: { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' },
      deviceMember: { orgId: 'org-a', uid: 'owner-a', status: 'active' },
      actorMember: { orgId: 'org-a', uid: 'actor-a', status: 'active' },
      delegation: {
        status: 'active', orgId: 'org-a', actingForUserId: 'actor-a', agentId: 'pip',
        conversationId: 'conversation-a', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      job: {
        deviceId: 'device-a', orgId: 'org-a', actorUserId: 'actor-a', workspaceId: 'workspace-a',
        mappingId: 'map-a', agentId: 'pip', conversationId: 'conversation-a', delegationId: 'delegation-a',
      },
      credentialVersion: 3,
    }
    expect(isLinkedRunClaimAuthorized(base)).toBe(true)
    expect(isLinkedRunClaimAuthorized({ ...base, device: { ...base.device, availableAgentIds: ['theo'] } })).toBe(false)
    expect(isLinkedRunClaimAuthorized({ ...base, delegation: { ...base.delegation, conversationId: 'conversation-b' } })).toBe(false)
    expect(isLinkedRunClaimAuthorized({ ...base, delegation: { ...base.delegation, status: 'revoked' } })).toBe(false)
  })

  it('denies project work after its replica is unlinked or organisation access is revoked', () => {
    const authorize = isLinkedRunClaimAuthorized as unknown as (input: Record<string, unknown>) => boolean
    const base = {
      authenticatedDeviceUserId: 'owner-a',
      device: { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active', credentialVersion: 3, capabilities: ['workspace.execute'] },
      grant: { deviceId: 'device-a', orgId: 'org-a', status: 'active', accessMode: 'selected_users', allowedUserIds: ['selected-a'], capabilities: ['workspace.execute'] },
      mapping: { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'workspace-a', projectId: 'project-a', status: 'active' },
      deviceMember: { orgId: 'org-a', uid: 'owner-a', status: 'active' },
      actorMember: { orgId: 'org-a', uid: 'selected-a', status: 'active' },
      project: { clientOrgIds: ['org-a'] },
      projectOrganization: { projectId: 'project-a', orgId: 'org-a', status: 'active' },
      projectReplica: {
        replicaId: 'replica-a', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
        locationId: 'linked-device:device-a', mappingId: 'map-a', relativePath: 'projects/project-a', active: true,
      },
      job: {
        deviceId: 'device-a', orgId: 'org-a', actorUserId: 'selected-a', workspaceId: 'workspace-a',
        projectId: 'project-a', projectReplicaId: 'replica-a', mappingId: 'map-a', relativeFolder: 'projects/project-a',
      },
      credentialVersion: 3,
    }

    expect(authorize(base)).toBe(true)
    expect(authorize({ ...base, projectReplica: { ...base.projectReplica, active: false } })).toBe(false)
    expect(authorize({ ...base, projectOrganization: { ...base.projectOrganization, status: 'revoked' } })).toBe(false)
    expect(authorize({ ...base, job: { ...base.job, projectReplicaId: undefined } })).toBe(false)
    expect(authorize({ ...base, grant: { ...base.grant, status: 'revoked' } })).toBe(false)
    expect(authorize({ ...base, mapping: { ...base.mapping, status: 'revoked' } })).toBe(false)
    expect(authorize({ ...base, actorMember: { ...base.actorMember, status: 'revoked' } })).toBe(false)
  })

  it('treats a replica path change as an authorization change', () => {
    const authorize = isLinkedRunClaimAuthorized as unknown as (input: Record<string, unknown>) => boolean
    const base = {
      authenticatedDeviceUserId: 'owner-a',
      device: { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active', credentialVersion: 3, capabilities: ['workspace.execute'] },
      grant: { deviceId: 'device-a', orgId: 'org-a', status: 'active', accessMode: 'selected_users', allowedUserIds: ['selected-a'], capabilities: ['workspace.execute'] },
      mapping: { mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' },
      deviceMember: { orgId: 'org-a', uid: 'owner-a', status: 'active' },
      actorMember: { orgId: 'org-a', uid: 'selected-a', status: 'active' },
      project: { clientOrgIds: ['org-a'] },
      projectOrganization: { projectId: 'project-a', orgId: 'org-a', status: 'active' },
      projectReplica: {
        replicaId: 'replica-a', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
        locationId: 'linked-device:device-a', mappingId: 'map-a', relativePath: 'projects/current', active: true,
      },
      job: {
        deviceId: 'device-a', orgId: 'org-a', actorUserId: 'selected-a', workspaceId: 'workspace-a',
        projectId: 'project-a', projectReplicaId: 'replica-a', mappingId: 'map-a', relativeFolder: 'projects/old',
      },
      credentialVersion: 3,
    }

    expect(authorize(base)).toBe(false)
    expect(authorize({
      ...base,
      job: { ...base.job, relativeFolder: 'projects/current' },
    })).toBe(true)
  })

  it('returns a path-safe claim and no secrets or physical paths', async () => {
    const req = new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/claim', { method: 'POST', body: '{}' })
    const response = await handleLinkedRunClaim(req, 'device-a', async () => identity, async () => claim)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual(claim)
    expect(JSON.stringify(body)).not.toMatch(/Users\/|C:\\\\|credential|publicKey|endpoint|token/i)
  })

  it('fails closed when signed identity and path device differ', async () => {
    const req = new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/claim', { method: 'POST', body: '{}' })
    const response = await handleLinkedRunClaim(req, 'device-a', async () => ({ ...identity, deviceId: 'device-b' }), async () => claim)
    expect(response.status).toBe(403)
  })

  it('binds progress and completion to path device and job', async () => {
    const progressReq = new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/job-a/progress', { method: 'POST', body: JSON.stringify({ receipt: { jobId: 'job-a' }, message: 'working' }) })
    const progress = jest.fn(async () => ({}))
    expect((await handleLinkedRunProgress(progressReq, 'device-a', 'job-a', async () => identity, progress)).status).toBe(200)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-a', ownerUserId: 'user-a', jobId: 'job-a', event: 'progress' }))

    const completeReq = new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/job-a/complete', { method: 'POST', body: JSON.stringify({ receipt: { jobId: 'job-a' }, outcome: 'completed', output: 'done' }) })
    const complete = jest.fn(async () => ({}))
    expect((await handleLinkedRunComplete(completeReq, 'device-a', 'job-a', async () => identity, complete)).status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-a', ownerUserId: 'user-a', jobId: 'job-a', event: 'complete', output: 'done' }))
  })

  it('keeps a signed capacity receipt in the public queued lifecycle', async () => {
    const queuedReq = new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/job-a/progress', {
      method: 'POST',
      body: JSON.stringify({ receipt: { jobId: 'job-a', event: 'queued', outcome: 'queued', queueReason: 'agent_capacity' } }),
    })
    const update = jest.fn(async () => ({}))
    expect((await handleLinkedRunProgress(queuedReq, 'device-a', 'job-a', async () => identity, update)).status).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a',
      jobId: 'job-a',
      event: 'queue',
      receipt: expect.objectContaining({ queueReason: 'agent_capacity' }),
    }))
  })
})
