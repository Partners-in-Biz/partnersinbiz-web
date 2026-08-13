import { NextRequest } from 'next/server'
import { handleCreateWorkbenchSession, handleListWorkbenchSessions } from '@/app/api/v1/conversations/[convId]/workbench/sessions/route'
import { handleGetWorkbenchSession } from '@/app/api/v1/conversations/[convId]/workbench/sessions/[sessionId]/route'
import { handleApproveWorkbenchSession } from '@/app/api/v1/conversations/[convId]/workbench/sessions/[sessionId]/approve/route'
import { handleWorkbenchSessionStdin } from '@/app/api/v1/conversations/[convId]/workbench/sessions/[sessionId]/stdin/route'
import { handleWorkbenchSessionResize } from '@/app/api/v1/conversations/[convId]/workbench/sessions/[sessionId]/resize/route'
import { handleWorkbenchSessionKill } from '@/app/api/v1/conversations/[convId]/workbench/sessions/[sessionId]/kill/route'
import { handleWorkbenchSessionClaim } from '@/app/api/v1/linked-computers/[deviceId]/workbench/sessions/claim/route'
import { handleWorkbenchSessionProgress } from '@/app/api/v1/linked-computers/[deviceId]/workbench/sessions/[sessionId]/progress/route'
import { handleWorkbenchSessionComplete } from '@/app/api/v1/linked-computers/[deviceId]/workbench/sessions/[sessionId]/complete/route'
import { isWorkbenchSessionClaimAuthorized, type WorkbenchSessionStoredAuthorization } from '@/lib/messages/workbench/session-store'
import type { WorkbenchSession } from '@/lib/messages/workbench/sessions'

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
    platform: 'macos' as const,
  },
}

function session(overrides: Partial<WorkbenchSession> = {}): WorkbenchSession {
  return {
    sessionId: 'wbs_a',
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
    shell: 'zsh',
    cols: 120,
    rows: 40,
    status: 'queued',
    attempt: 0,
    approvedByUserId: 'user-a',
    approvedAtMs: 1_500,
    encryptedCreateControl: { ciphertext: 'cipher', iv: 'iv', tag: 'tag' },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    ttlExpiresAtMs: 100_000,
    ...overrides,
  }
}

/** A freshly-created session: `awaiting_approval`, with no approval recorded yet. */
function awaitingApprovalSession(overrides: Partial<WorkbenchSession> = {}): WorkbenchSession {
  const { approvedByUserId: _approvedByUserId, approvedAtMs: _approvedAtMs, ...rest } = session()
  return { ...rest, status: 'awaiting_approval', ...overrides }
}

describe('conversation workbench session browser routes', () => {
  it('creates a session using only the conversation-derived device binding and a server-chosen shell', async () => {
    const authorize = jest.fn(async () => authorization)
    const create = jest.fn(async () => awaitingApprovalSession())
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols: 100, rows: 30, shell: 'powershell', deviceId: 'device-b', orgId: 'org-b' }),
    })

    const response = await handleCreateWorkbenchSession(request, user, 'conversation-a', { authorize, create })

    expect(response.status).toBe(202)
    expect(authorize).toHaveBeenCalledWith(user, 'conversation-a')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-a', orgId: 'org-a', actorUserId: 'user-a',
      deviceId: 'device-a', runtimeTargetId: 'runtime-a', workspaceId: 'workspace-a', mappingId: 'mapping-a',
      projectId: 'project-a', projectReplicaId: 'replica-a', relativeFolder: 'projects/project-a',
      shell: 'zsh', cols: 100, rows: 30, cwd: '.',
    }))
    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ shell: 'powershell' }))
    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-b' }))
    const body = await response.json()
    expect(body.data.status).toBe('awaiting_approval')
    expect(body.data.approvalRequired).toBe(true)
  })

  it('rejects out-of-range dimensions before authorizing', async () => {
    const authorize = jest.fn(async () => authorization)
    const create = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions', {
      method: 'POST', body: JSON.stringify({ cols: 'wide' }),
    })

    const response = await handleCreateWorkbenchSession(request, user, 'conversation-a', { authorize, create })

    expect(response.status).toBe(400)
    expect(authorize).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('maps an already-active session conflict to 409', async () => {
    const create = jest.fn(async () => { throw new Error('workbench: session already active') })
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions', { method: 'POST', body: '{}' })

    const response = await handleCreateWorkbenchSession(request, user, 'conversation-a', { authorize: async () => authorization, create })

    expect(response.status).toBe(409)
  })

  it('lists only this user\'s context-bound sessions for the terminal rehydrate path', async () => {
    const authorize = jest.fn(async () => authorization)
    // The store already filters terminal statuses; the handler narrows ownership.
    const list = jest.fn(async () => [
      // Matches user-a + authorization binding exactly -> included.
      session({ status: 'running' }),
      // Another actor's session -> excluded by ownership narrowing.
      session({ status: 'running', actorUserId: 'user-b' }),
      // Different device binding -> excluded by ownership narrowing.
      session({ status: 'running', deviceId: 'device-other' }),
    ])
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions')

    const response = await handleListWorkbenchSessions(request, user, 'conversation-a', { authorize, list })

    expect(response.status).toBe(200)
    expect(authorize).toHaveBeenCalledWith(user, 'conversation-a')
    const body = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ sessionId: 'wbs_a', status: 'running' })
  })

  it('returns an empty list when no session is owned by the caller', async () => {
    const authorize = jest.fn(async () => authorization)
    const list = jest.fn(async () => [session({ status: 'running', actorUserId: 'user-b' })])
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions')

    const response = await handleListWorkbenchSessions(request, user, 'conversation-a', { authorize, list })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual([])
  })

  it('forbids non-client/admin roles from listing sessions', async () => {
    const authorize = jest.fn(async () => authorization)
    const list = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions')
    const staffUser = { uid: 'staff-a', role: 'staff' as const, orgId: 'org-a' }

    const response = await handleListWorkbenchSessions(request, staffUser, 'conversation-a', { authorize, list })

    expect(response.status).toBe(403)
    expect(list).not.toHaveBeenCalled()
  })

  it('rechecks conversation/project/runtime authorization and exact session ownership before polling', async () => {
    const authorize = jest.fn(async () => authorization)
    const get = jest.fn(async () => session({ actorUserId: 'user-b' }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions/wbs_a')

    const response = await handleGetWorkbenchSession(request, user, 'conversation-a', 'wbs_a', { authorize, get })

    expect(response.status).toBe(404)
    expect(authorize).toHaveBeenCalledWith(user, 'conversation-a')
  })

  it('enqueues stdin only after rechecking ownership, forwarding the exact binding', async () => {
    const authorize = jest.fn(async () => authorization)
    const get = jest.fn(async () => session({ status: 'running' }))
    const enqueue = jest.fn(async () => session({ status: 'running' }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions/wbs_a/stdin', {
      method: 'POST', body: JSON.stringify({ data: 'ls\n', mode: 'line' }),
    })

    const response = await handleWorkbenchSessionStdin(request, user, 'conversation-a', 'wbs_a', { authorize, get, enqueue })

    expect(response.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wbs_a', conversationId: 'conversation-a', orgId: 'org-a', actorUserId: 'user-a',
      deviceId: 'device-a', mappingId: 'mapping-a', data: 'ls\n', mode: 'line',
    }))
  })

  it('rejects malformed stdin before touching the store', async () => {
    const enqueue = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions/wbs_a/stdin', {
      method: 'POST', body: JSON.stringify({ data: '' }),
    })

    const response = await handleWorkbenchSessionStdin(request, user, 'conversation-a', 'wbs_a', {
      authorize: async () => authorization, get: async () => session({ status: 'running' }), enqueue,
    })

    expect(response.status).toBe(400)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('maps a not-running session to 409 when sending stdin', async () => {
    const enqueue = jest.fn(async () => { throw new Error('workbench: session not running') })
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions/wbs_a/stdin', {
      method: 'POST', body: JSON.stringify({ data: 'ls\n' }),
    })

    const response = await handleWorkbenchSessionStdin(request, user, 'conversation-a', 'wbs_a', {
      authorize: async () => authorization, get: async () => session({ status: 'queued' }), enqueue,
    })

    expect(response.status).toBe(409)
  })

  it('enqueues a resize with sanitized dimensions', async () => {
    const enqueue = jest.fn(async () => session({ status: 'running', cols: 200, rows: 60 }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions/wbs_a/resize', {
      method: 'POST', body: JSON.stringify({ cols: 999, rows: -5 }),
    })

    const response = await handleWorkbenchSessionResize(request, user, 'conversation-a', 'wbs_a', {
      authorize: async () => authorization, get: async () => session({ status: 'running' }), enqueue,
    })

    expect(response.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'wbs_a', cols: 300, rows: 1 }))
  })

  it('approves an awaiting_approval session using only the rechecked binding', async () => {
    const get = jest.fn(async () => awaitingApprovalSession())
    const approve = jest.fn(async () => session())
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions/wbs_a/approve', { method: 'POST' })

    const response = await handleApproveWorkbenchSession(request, user, 'conversation-a', 'wbs_a', {
      authorize: async () => authorization, get, approve,
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wbs_a', approverUserId: 'user-a', conversationId: 'conversation-a', deviceId: 'device-a', mappingId: 'mapping-a',
    }))
    expect(body.data.status).toBe('queued')
    expect(body.data.approvalRequired).toBe(false)
  })

  it('rejects approving a session that is no longer awaiting_approval', async () => {
    const approve = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions/wbs_a/approve', { method: 'POST' })

    const response = await handleApproveWorkbenchSession(request, user, 'conversation-a', 'wbs_a', {
      authorize: async () => authorization, get: async () => session(), approve,
    })

    expect(response.status).toBe(409)
    expect(approve).not.toHaveBeenCalled()
  })

  it('refuses to approve a session belonging to another user', async () => {
    const approve = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions/wbs_a/approve', { method: 'POST' })

    const response = await handleApproveWorkbenchSession(request, user, 'conversation-a', 'wbs_a', {
      authorize: async () => authorization, get: async () => awaitingApprovalSession({ actorUserId: 'user-b' }), approve,
    })

    expect(response.status).toBe(404)
    expect(approve).not.toHaveBeenCalled()
  })

  it('kills a session using only the rechecked binding', async () => {
    const enqueue = jest.fn(async () => session({ status: 'killed' }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/sessions/wbs_a/kill', { method: 'POST' })

    const response = await handleWorkbenchSessionKill(request, user, 'conversation-a', 'wbs_a', {
      authorize: async () => authorization, get: async () => session({ status: 'queued' }), enqueue,
    })

    expect(response.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wbs_a', conversationId: 'conversation-a', deviceId: 'device-a', mappingId: 'mapping-a',
    }))
  })
})

describe('signed linked-computer workbench session routes', () => {
  const identity = { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 }

  it('claims only for the signed path device and returns no server path or credential fields', async () => {
    const claim = jest.fn(async () => ({
      kind: 'create' as const, sessionId: 'wbs_a', shell: 'zsh' as const, cols: 120, rows: 40, cwd: '.',
      workspaceId: 'workspace-a', mappingId: 'mapping-a', relativeFolder: 'projects/project-a',
      attempt: 1, leaseToken: 'lease-token-1234567890',
    }))
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/sessions/claim', { method: 'POST', body: '{}' })

    const response = await handleWorkbenchSessionClaim(request, 'device-a', async () => identity, claim)

    expect(response.status).toBe(200)
    expect(claim).toHaveBeenCalledWith({ deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 })
    expect(JSON.stringify(await response.json())).not.toMatch(/Users\/|credential|publicKey|encrypted/i)
  })

  it('returns 204 when there is no pending session work', async () => {
    const claim = jest.fn(async () => null)
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/sessions/claim', { method: 'POST', body: '{}' })

    const response = await handleWorkbenchSessionClaim(request, 'device-a', async () => identity, claim)

    expect(response.status).toBe(204)
  })

  it('binds progress to the signed device, path session, attempt, and lease, and renews the lease', async () => {
    const append = jest.fn(async () => ({ sessionId: 'wbs_a', leaseExpiresAtMs: 30_000, status: 'running' as const }))
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/sessions/wbs_a/progress', {
      method: 'POST',
      body: JSON.stringify({
        attempt: 1, leaseToken: 'lease-token-1234567890',
        chunk: { seq: 0, stream: 'stdout', text: '$ ls\n', atMs: 1_000 },
      }),
    })

    const response = await handleWorkbenchSessionProgress(request, 'device-a', 'wbs_a', async () => identity, append)

    expect(response.status).toBe(200)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3, sessionId: 'wbs_a',
      attempt: 1, leaseToken: 'lease-token-1234567890',
      chunk: { seq: 0, stream: 'stdout', text: '$ ls\n', atMs: 1_000 },
    }))
    const body = await response.json()
    expect(body.data).toMatchObject({ accepted: true, sessionId: 'wbs_a', status: 'running' })
  })

  it('rejects a progress request with a malformed attempt or lease token before touching the store', async () => {
    const append = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/sessions/wbs_a/progress', {
      method: 'POST',
      body: JSON.stringify({ attempt: 0, leaseToken: 'short', chunk: { seq: 0, stream: 'stdout', text: 'x', atMs: 1 } }),
    })

    const response = await handleWorkbenchSessionProgress(request, 'device-a', 'wbs_a', async () => identity, append)

    expect(response.status).toBe(400)
    expect(append).not.toHaveBeenCalled()
  })

  it('binds completion to the signed device, path session, attempt, and lease', async () => {
    const complete = jest.fn(async () => session({ status: 'exited', exitCode: 0 }))
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/sessions/wbs_a/complete', {
      method: 'POST',
      body: JSON.stringify({ attempt: 1, leaseToken: 'lease-token-1234567890', outcome: 'exited', exitCode: 0 }),
    })

    const response = await handleWorkbenchSessionComplete(request, 'device-a', 'wbs_a', async () => identity, complete)

    expect(response.status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3, sessionId: 'wbs_a',
      attempt: 1, leaseToken: 'lease-token-1234567890', outcome: 'exited', exitCode: 0,
    }))
  })

  it('rejects an unknown outcome before touching the store', async () => {
    const complete = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/sessions/wbs_a/complete', {
      method: 'POST',
      body: JSON.stringify({ attempt: 1, leaseToken: 'lease-token-1234567890', outcome: 'completed' }),
    })

    const response = await handleWorkbenchSessionComplete(request, 'device-a', 'wbs_a', async () => identity, complete)

    expect(response.status).toBe(400)
    expect(complete).not.toHaveBeenCalled()
  })
})

describe('workbench session claim authorization', () => {
  const stored: WorkbenchSessionStoredAuthorization = {
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

  it('rechecks grant, mapping, conversation participation, project, and session ownership', () => {
    const input = { authenticatedDeviceUserId: 'owner-a', credentialVersion: 3, authorization: stored, session: session() }
    expect(isWorkbenchSessionClaimAuthorized(input)).toBe(true)
    expect(isWorkbenchSessionClaimAuthorized({ ...input, authorization: { ...stored, grant: { ...stored.grant, status: 'revoked' } } })).toBe(false)
    expect(isWorkbenchSessionClaimAuthorized({ ...input, authorization: { ...stored, mapping: { ...stored.mapping, status: 'revoked' } } })).toBe(false)
    expect(isWorkbenchSessionClaimAuthorized({ ...input, authorization: { ...stored, conversation: { ...stored.conversation, participantUids: [] } } })).toBe(false)
    expect(isWorkbenchSessionClaimAuthorized({ ...input, authorization: { ...stored, conversation: { ...stored.conversation, orgId: 'org-b' } } })).toBe(false)
    expect(isWorkbenchSessionClaimAuthorized({ ...input, session: session({ conversationId: 'conversation-b' }) })).toBe(false)
    expect(isWorkbenchSessionClaimAuthorized({ ...input, authorization: { ...stored, projectOrganization: { ...stored.projectOrganization, status: 'revoked' } } })).toBe(false)
  })

  it('authorizes a root session when the conversation persists its folder as an empty string', () => {
    const rootStored: WorkbenchSessionStoredAuthorization = {
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
    const rootSession = session({
      projectId: undefined,
      projectReplicaId: undefined,
      relativeFolder: '.',
    })

    expect(isWorkbenchSessionClaimAuthorized({
      authenticatedDeviceUserId: 'owner-a',
      credentialVersion: 3,
      authorization: rootStored,
      session: rootSession,
    })).toBe(true)
  })
})
