import { NextRequest } from 'next/server'
import { handleCreateWorkbenchJob } from '@/app/api/v1/conversations/[convId]/workbench/jobs/route'
import { handleGetWorkbenchJob } from '@/app/api/v1/conversations/[convId]/workbench/jobs/[jobId]/route'
import { handleApproveWorkbenchJob } from '@/app/api/v1/conversations/[convId]/workbench/jobs/[jobId]/approve/route'
import { handleWorkbenchClaim } from '@/app/api/v1/linked-computers/[deviceId]/workbench/claim/route'
import { handleWorkbenchComplete } from '@/app/api/v1/linked-computers/[deviceId]/workbench/jobs/[jobId]/complete/route'
import { handleWorkbenchProgress } from '@/app/api/v1/linked-computers/[deviceId]/workbench/jobs/[jobId]/progress/route'
import { isWorkbenchClaimAuthorized, type WorkbenchStoredAuthorization } from '@/lib/messages/workbench/job-store'
import type { WorkbenchJob } from '@/lib/messages/workbench/jobs'

const user = { uid: 'user-a', role: 'client' as const, orgId: 'org-a' }
const authorization = {
  conversation: { id: 'conversation-a', orgId: 'org-a' },
  projectId: 'project-a',
  projectReplicaId: 'replica-a',
  relativeFolder: 'projects/project-a',
  binding: {
    kind: 'linked-computer' as const,
    deviceId: 'device-a',
    runtimeTargetId: 'runtime-a',
    credentialVersion: 3,
    workspaceId: 'workspace-a',
    mappingId: 'mapping-a',
  },
}

function job(overrides: Partial<WorkbenchJob> = {}): WorkbenchJob {
  return {
    jobId: 'job-a',
    idempotencyKey: 'idem-12345678',
    requestFingerprint: 'fingerprint-a',
    conversationId: 'conversation-a',
    orgId: 'org-a',
    actorUserId: 'user-a',
    actorRole: 'client',
    deviceId: 'device-a',
    runtimeTargetId: 'runtime-a',
    credentialVersion: 3,
    workspaceId: 'workspace-a',
    mappingId: 'mapping-a',
    projectId: 'project-a',
    projectReplicaId: 'replica-a',
    relativeFolder: 'projects/project-a',
    kind: 'fs.list',
    status: 'queued',
    attempt: 0,
    encryptedOperation: { ciphertext: 'cipher', iv: 'iv', tag: 'tag' },
    encryptedResult: null,
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    expiresAtMs: 100_000,
    ...overrides,
  }
}

describe('conversation workbench browser routes', () => {
  it('enqueues a typed read using only the conversation-derived device binding', async () => {
    const authorize = jest.fn(async () => authorization)
    const enqueue = jest.fn(async (input: Record<string, unknown>) => job({ kind: 'fs.read' }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-12345678' },
      body: JSON.stringify({
        operation: { kind: 'fs.read', path: 'src/index.ts' },
        orgId: 'org-b', deviceId: 'device-b', mappingId: 'mapping-b',
      }),
    })

    const response = await handleCreateWorkbenchJob(request, user, 'conversation-a', { authorize, enqueue })

    expect(response.status).toBe(202)
    expect(authorize).toHaveBeenCalledWith(user, 'conversation-a')
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-a', orgId: 'org-a', actorUserId: 'user-a',
      deviceId: 'device-a', runtimeTargetId: 'runtime-a', workspaceId: 'workspace-a',
      mappingId: 'mapping-a', projectId: 'project-a', projectReplicaId: 'replica-a',
      relativeFolder: 'projects/project-a', kind: 'fs.read',
    }))
    expect(enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-b' }))
  })

  it('creates fs.write only as awaiting approval', async () => {
    const enqueue = jest.fn(async () => job({ kind: 'fs.write', status: 'awaiting_approval' }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'write-12345678' },
      body: JSON.stringify({ operation: { kind: 'fs.write', path: 'src/index.ts', content: 'safe content' } }),
    })

    const response = await handleCreateWorkbenchJob(request, user, 'conversation-a', {
      authorize: async () => authorization,
      enqueue,
    })
    expect(response.status).toBe(202)
    expect((await response.json()).data).toMatchObject({ kind: 'fs.write', status: 'awaiting_approval', approvalRequired: true })
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fs.write' }))
  })

  it('rechecks conversation/project/runtime authorization and exact job ownership before polling', async () => {
    const authorize = jest.fn(async () => authorization)
    const get = jest.fn(async () => job({ actorUserId: 'user-b' }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/jobs/job-a')

    const response = await handleGetWorkbenchJob(request, user, 'conversation-a', 'job-a', { authorize, get })

    expect(response.status).toBe(404)
    expect(authorize).toHaveBeenCalledWith(user, 'conversation-a')
  })

  it('rechecks authorization and binding before the owning user approves a write', async () => {
    const authorize = jest.fn(async () => authorization)
    const get = jest.fn(async () => job({ kind: 'fs.write', status: 'awaiting_approval' }))
    const approve = jest.fn(async () => job({ kind: 'fs.write', status: 'queued', approvedByUserId: 'user-a' }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/jobs/job-a/approve', { method: 'POST' })

    const response = await handleApproveWorkbenchJob(request, user, 'conversation-a', 'job-a', { authorize, get, approve })

    expect(response.status).toBe(200)
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-a', approverUserId: 'user-a', conversationId: 'conversation-a', orgId: 'org-a',
      deviceId: 'device-a', mappingId: 'mapping-a', projectReplicaId: 'replica-a',
    }))
  })
})

describe('signed linked-computer workbench routes', () => {
  const identity = { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 }

  it('claims only for the signed path device and returns no server path or credential fields', async () => {
    const claim = jest.fn(async () => ({
      jobId: 'job-a', kind: 'fs.list', operation: { kind: 'fs.list', path: '.' },
      workspaceId: 'workspace-a', mappingId: 'mapping-a', relativeFolder: 'projects/project-a',
      attempt: 1, leaseToken: 'lease-token-1234567890',
    }))
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/claim', { method: 'POST', body: '{}' })

    const response = await handleWorkbenchClaim(request, 'device-a', async () => identity, claim)

    expect(response.status).toBe(200)
    expect(claim).toHaveBeenCalledWith({ deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 })
    expect(JSON.stringify(await response.json())).not.toMatch(/Users\/|credential|publicKey|encrypted/i)
  })

  it('binds completion to the signed device, path job, attempt, and lease', async () => {
    const complete = jest.fn(async () => job({ status: 'completed' }))
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/jobs/job-a/complete', {
      method: 'POST',
      body: JSON.stringify({ attempt: 1, leaseToken: 'lease-token-1234567890', outcome: 'completed', result: { entries: [] } }),
    })

    const response = await handleWorkbenchComplete(request, 'device-a', 'job-a', async () => identity, complete)

    expect(response.status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3, jobId: 'job-a',
      attempt: 1, leaseToken: 'lease-token-1234567890', outcome: 'completed', result: { entries: [] },
    }))
  })

  it('binds progress to the signed device, path job, attempt, and lease, and renews the lease', async () => {
    const append = jest.fn(async () => ({ jobId: 'job-a', leaseExpiresAtMs: 30_000 }))
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/jobs/job-a/progress', {
      method: 'POST',
      body: JSON.stringify({
        attempt: 1, leaseToken: 'lease-token-1234567890',
        chunk: { seq: 0, stream: 'stdout', text: 'v20.0.0\n', atMs: 1_000 },
      }),
    })

    const response = await handleWorkbenchProgress(request, 'device-a', 'job-a', async () => identity, append)

    expect(response.status).toBe(200)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3, jobId: 'job-a',
      attempt: 1, leaseToken: 'lease-token-1234567890',
      chunk: { seq: 0, stream: 'stdout', text: 'v20.0.0\n', atMs: 1_000 },
    }))
    const body = await response.json()
    expect(body.data).toMatchObject({ accepted: true, jobId: 'job-a' })
  })

  it('rejects a progress request with a malformed attempt or lease token before touching the store', async () => {
    const append = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/jobs/job-a/progress', {
      method: 'POST',
      body: JSON.stringify({ attempt: 0, leaseToken: 'short', chunk: { seq: 0, stream: 'stdout', text: 'x', atMs: 1 } }),
    })

    const response = await handleWorkbenchProgress(request, 'device-a', 'job-a', async () => identity, append)

    expect(response.status).toBe(400)
    expect(append).not.toHaveBeenCalled()
  })
})

describe('workbench claim authorization', () => {
  const stored: WorkbenchStoredAuthorization = {
    device: { deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active', credentialVersion: 3, capabilities: ['workspace.execute'] },
    grant: { deviceId: 'device-a', orgId: 'org-a', status: 'active', accessMode: 'selected_users', allowedUserIds: ['user-a'], capabilities: ['workspace.execute'] },
    mapping: { mappingId: 'mapping-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'workspace-a', projectId: 'project-a', status: 'active' },
    deviceMember: { orgId: 'org-a', uid: 'owner-a', status: 'active' },
    actorMember: { orgId: 'org-a', uid: 'user-a', role: 'client', status: 'active' },
    conversation: { id: 'conversation-a', orgId: 'org-a', participantUids: ['user-a'], workspaceContext: { orgId: 'org-a', workspaceId: 'workspace-a', mappingId: 'mapping-a', runtimeTarget: 'runtime-a', projectId: 'project-a', shareMode: 'private' } },
    project: { clientOrgIds: ['org-a'] },
    projectOrganization: { projectId: 'project-a', orgId: 'org-a', status: 'active' },
    projectReplica: { replicaId: 'replica-a', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a', relativePath: 'projects/project-a', active: true },
  }

  it('rechecks grant, mapping, conversation participation, project, and job ownership', () => {
    const input = { authenticatedDeviceUserId: 'owner-a', credentialVersion: 3, authorization: stored, job: job() }
    expect(isWorkbenchClaimAuthorized(input)).toBe(true)
    expect(isWorkbenchClaimAuthorized({ ...input, authorization: { ...stored, grant: { ...stored.grant, status: 'revoked' } } })).toBe(false)
    expect(isWorkbenchClaimAuthorized({ ...input, authorization: { ...stored, mapping: { ...stored.mapping, status: 'revoked' } } })).toBe(false)
    expect(isWorkbenchClaimAuthorized({ ...input, authorization: { ...stored, conversation: { ...stored.conversation, participantUids: [] } } })).toBe(false)
    expect(isWorkbenchClaimAuthorized({ ...input, authorization: { ...stored, conversation: { ...stored.conversation, orgId: 'org-b' } } })).toBe(false)
    expect(isWorkbenchClaimAuthorized({ ...input, authorization: { ...stored, conversation: { ...stored.conversation, workspaceContext: { ...stored.conversation!.workspaceContext as object, orgId: 'org-b' } } } })).toBe(false)
    expect(isWorkbenchClaimAuthorized({ ...input, job: job({ conversationId: 'conversation-b' }) })).toBe(false)
    expect(isWorkbenchClaimAuthorized({ ...input, authorization: { ...stored, projectOrganization: { ...stored.projectOrganization, status: 'revoked' } } })).toBe(false)
  })

  it('authorizes a root job when the conversation persists its folder as an empty string', () => {
    const rootStored: WorkbenchStoredAuthorization = {
      ...stored,
      mapping: { ...stored.mapping, projectId: undefined },
      conversation: {
        ...stored.conversation,
        workspaceContext: {
          ...(stored.conversation!.workspaceContext as object),
          projectId: undefined,
          folderRelativePath: '',
        },
      },
      project: undefined,
      projectOrganization: undefined,
      projectReplica: undefined,
    }
    const rootJob = job({
      projectId: undefined,
      projectReplicaId: undefined,
      relativeFolder: '.',
    })

    expect(isWorkbenchClaimAuthorized({
      authenticatedDeviceUserId: 'owner-a',
      credentialVersion: 3,
      authorization: rootStored,
      job: rootJob,
    })).toBe(true)
  })

  it('binds a company-root job to the immutable company workspace identity', () => {
    const companyStored: WorkbenchStoredAuthorization = {
      ...stored,
      mapping: { ...stored.mapping, projectId: undefined },
      conversation: {
        ...stored.conversation,
        workspaceContext: {
          ...(stored.conversation!.workspaceContext as object),
          projectId: undefined,
          folderScope: 'company',
          companyWorkspaceId: 'loyalty-plus-workspace',
          localWorkingPath: '/Users/private/Cowork/partners/Loyalty Plus',
          vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Loyalty Plus',
          folderRelativePath: '',
        },
      },
      project: undefined,
      projectOrganization: undefined,
      projectReplica: undefined,
    }
    const companyJob = job({
      projectId: undefined,
      projectReplicaId: undefined,
      rootBindingId: 'loyalty-plus-workspace',
      relativeFolder: '.',
    })
    const input = {
      authenticatedDeviceUserId: 'owner-a',
      credentialVersion: 3,
      authorization: companyStored,
      job: companyJob,
    }
    expect(isWorkbenchClaimAuthorized(input)).toBe(true)
    expect(isWorkbenchClaimAuthorized({
      ...input,
      job: { ...companyJob, rootBindingId: 'another-company' },
    })).toBe(false)
    expect(isWorkbenchClaimAuthorized({
      ...input,
      authorization: {
        ...companyStored,
        conversation: {
          ...companyStored.conversation,
          workspaceContext: {
            ...(companyStored.conversation!.workspaceContext as object),
            companyWorkspaceId: 'another-company',
          },
        },
      },
    })).toBe(false)
  })
})
