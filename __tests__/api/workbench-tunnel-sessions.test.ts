import { NextRequest } from 'next/server'
import { handleCreateTunnelSession } from '@/app/api/v1/conversations/[convId]/workbench/tunnel/sessions/route'
import { handleGetTunnelSession } from '@/app/api/v1/conversations/[convId]/workbench/tunnel/sessions/[sessionId]/route'
import { handleApproveTunnelSession } from '@/app/api/v1/conversations/[convId]/workbench/tunnel/sessions/[sessionId]/approve/route'
import { handleKillTunnelSession } from '@/app/api/v1/conversations/[convId]/workbench/tunnel/sessions/[sessionId]/kill/route'
import { handleWorkbenchTunnelClaim } from '@/app/api/v1/linked-computers/[deviceId]/workbench/tunnel/sessions/claim/route'
import { handleWorkbenchTunnelProgress } from '@/app/api/v1/linked-computers/[deviceId]/workbench/tunnel/sessions/[sessionId]/progress/route'
import { handleWorkbenchTunnelComplete } from '@/app/api/v1/linked-computers/[deviceId]/workbench/tunnel/sessions/[sessionId]/complete/route'
import { WORKBENCH_TUNNEL_BIND_HOST, WORKBENCH_TUNNEL_DEFAULT_PROVIDER, type WorkbenchTunnelSession } from '@/lib/messages/workbench/tunnel-sessions'

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

function tunnelSession(overrides: Partial<WorkbenchTunnelSession> = {}): WorkbenchTunnelSession {
  return {
    sessionId: 'wbt_a',
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
    port: 5173,
    bindHost: WORKBENCH_TUNNEL_BIND_HOST,
    provider: WORKBENCH_TUNNEL_DEFAULT_PROVIDER,
    status: 'awaiting_approval',
    attempt: 0,
    encryptedCreateControl: { ciphertext: 'cipher', iv: 'iv', tag: 'tag' },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    ttlExpiresAtMs: 100_000,
    ...overrides,
  }
}

describe('conversation workbench tunnel routes', () => {
  it('creates a tunnel using only the conversation-derived device binding and a sanitized port, always awaiting_approval', async () => {
    const authorize = jest.fn(async () => authorization)
    const create = jest.fn(async () => tunnelSession())
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/tunnel/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 5173, deviceId: 'device-b', orgId: 'org-b' }),
    })

    const response = await handleCreateTunnelSession(request, user, 'conversation-a', { authorize, create })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(authorize).toHaveBeenCalledWith(user, 'conversation-a')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-a', orgId: 'org-a', actorUserId: 'user-a',
      deviceId: 'device-a', runtimeTargetId: 'runtime-a', workspaceId: 'workspace-a', mappingId: 'mapping-a',
      projectId: 'project-a', projectReplicaId: 'replica-a', relativeFolder: 'projects/project-a', port: 5173,
    }))
    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-b' }))
    expect(body.data.status).toBe('awaiting_approval')
    expect(body.data.approvalRequired).toBe(true)
  })

  it('rejects an out-of-range port before authorizing', async () => {
    const authorize = jest.fn(async () => authorization)
    const create = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/tunnel/sessions', {
      method: 'POST', body: JSON.stringify({ port: 80 }),
    })

    const response = await handleCreateTunnelSession(request, user, 'conversation-a', { authorize, create })

    expect(response.status).toBe(400)
    expect(authorize).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('maps an already-active tunnel conflict to 409', async () => {
    const create = jest.fn(async () => { throw new Error('workbench: tunnel already active') })
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/tunnel/sessions', {
      method: 'POST', body: JSON.stringify({ port: 5173 }),
    })

    const response = await handleCreateTunnelSession(request, user, 'conversation-a', { authorize: async () => authorization, create })

    expect(response.status).toBe(409)
  })

  it('rechecks conversation/project/runtime authorization and exact tunnel ownership before polling', async () => {
    const authorize = jest.fn(async () => authorization)
    const get = jest.fn(async () => tunnelSession({ actorUserId: 'user-b' }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/tunnel/sessions/wbt_a')

    const response = await handleGetTunnelSession(request, user, 'conversation-a', 'wbt_a', { authorize, get })

    expect(response.status).toBe(404)
    expect(authorize).toHaveBeenCalledWith(user, 'conversation-a')
  })

  it('approves an awaiting_approval tunnel using only the rechecked binding', async () => {
    const get = jest.fn(async () => tunnelSession())
    const approve = jest.fn(async () => tunnelSession({ status: 'queued', approvedByUserId: 'user-a', approvedAtMs: 2_000 }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/tunnel/sessions/wbt_a/approve', { method: 'POST' })

    const response = await handleApproveTunnelSession(request, user, 'conversation-a', 'wbt_a', {
      authorize: async () => authorization, get, approve,
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wbt_a', approverUserId: 'user-a', conversationId: 'conversation-a', deviceId: 'device-a', mappingId: 'mapping-a',
    }))
    expect(body.data.status).toBe('queued')
    expect(body.data.approvalRequired).toBe(false)
  })

  it('rejects approving a tunnel that is no longer awaiting_approval', async () => {
    const approve = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/tunnel/sessions/wbt_a/approve', { method: 'POST' })

    const response = await handleApproveTunnelSession(request, user, 'conversation-a', 'wbt_a', {
      authorize: async () => authorization, get: async () => tunnelSession({ status: 'queued' }), approve,
    })

    expect(response.status).toBe(409)
    expect(approve).not.toHaveBeenCalled()
  })

  it('kills a tunnel using only the rechecked binding', async () => {
    const enqueue = jest.fn(async () => tunnelSession({ status: 'killed' }))
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/tunnel/sessions/wbt_a/kill', { method: 'POST' })

    const response = await handleKillTunnelSession(request, user, 'conversation-a', 'wbt_a', {
      authorize: async () => authorization, get: async () => tunnelSession(), enqueue,
    })

    expect(response.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wbt_a', conversationId: 'conversation-a', deviceId: 'device-a', mappingId: 'mapping-a',
    }))
  })

  it('returns 404 for kill/get/approve when the tunnel is not owned by this conversation/user', async () => {
    const request = new NextRequest('https://app.test/api/v1/conversations/conversation-a/workbench/tunnel/sessions/wbt_a/kill', { method: 'POST' })
    const response = await handleKillTunnelSession(request, user, 'conversation-a', 'wbt_a', {
      authorize: async () => authorization, get: async () => null, enqueue: jest.fn(),
    })
    expect(response.status).toBe(404)
  })
})

describe('signed linked-computer workbench tunnel routes', () => {
  const identity = { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 }

  it('claims only for the signed path device and returns no server path or credential fields', async () => {
    const claim = jest.fn(async () => ({
      kind: 'create' as const, sessionId: 'wbt_a', port: 5173, bindHost: '127.0.0.1' as const, provider: 'cloudflared' as const,
      workspaceId: 'workspace-a', mappingId: 'mapping-a', relativeFolder: 'projects/project-a',
      attempt: 1, leaseToken: 'lease-token-1234567890',
    }))
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/tunnel/sessions/claim', { method: 'POST', body: '{}' })

    const response = await handleWorkbenchTunnelClaim(request, 'device-a', async () => identity, claim)

    expect(response.status).toBe(200)
    expect(claim).toHaveBeenCalledWith({ deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 })
    expect(JSON.stringify(await response.json())).not.toMatch(/Users\/|credential|publicKey|encrypted|relativeFolder\W*['"]\/(?!projects)/i)
  })

  it('returns 204 when there is no pending tunnel work', async () => {
    const claim = jest.fn(async () => null)
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/tunnel/sessions/claim', { method: 'POST', body: '{}' })

    const response = await handleWorkbenchTunnelClaim(request, 'device-a', async () => identity, claim)

    expect(response.status).toBe(204)
  })

  it('rejects a claim request for a tenant/device mismatch with 403', async () => {
    const claim = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/tunnel/sessions/claim', { method: 'POST', body: '{}' })

    const response = await handleWorkbenchTunnelClaim(request, 'device-a', async () => ({ ...identity, deviceId: 'device-b' }), claim)

    expect(response.status).toBe(403)
    expect(claim).not.toHaveBeenCalled()
  })

  it('binds progress to the signed device, path session, attempt, and lease, and renews the lease', async () => {
    const append = jest.fn(async () => ({ sessionId: 'wbt_a', leaseExpiresAtMs: 92_000, status: 'running' as const, publicUrl: 'https://abcd.trycloudflare.com' }))
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/tunnel/sessions/wbt_a/progress', {
      method: 'POST',
      body: JSON.stringify({
        attempt: 1, leaseToken: 'lease-token-1234567890',
        chunk: { seq: 0, stream: 'tunnel', publicUrl: 'https://abcd.trycloudflare.com', localUrl: 'http://127.0.0.1:5173', atMs: 1_000 },
      }),
    })

    const response = await handleWorkbenchTunnelProgress(request, 'device-a', 'wbt_a', async () => identity, append)

    expect(response.status).toBe(200)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3, sessionId: 'wbt_a',
      attempt: 1, leaseToken: 'lease-token-1234567890',
    }))
    const body = await response.json()
    expect(body.data).toMatchObject({ accepted: true, sessionId: 'wbt_a', status: 'running', publicUrl: 'https://abcd.trycloudflare.com' })
  })

  it('rejects a progress request with a malformed attempt or lease token before touching the store', async () => {
    const append = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/tunnel/sessions/wbt_a/progress', {
      method: 'POST',
      body: JSON.stringify({ attempt: 0, leaseToken: 'short', chunk: { seq: 0, stream: 'status', text: 'x', atMs: 1 } }),
    })

    const response = await handleWorkbenchTunnelProgress(request, 'device-a', 'wbt_a', async () => identity, append)

    expect(response.status).toBe(400)
    expect(append).not.toHaveBeenCalled()
  })

  it('maps a stale lease error to 409', async () => {
    const append = jest.fn(async () => { throw new Error('workbench: lease mismatch') })
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/tunnel/sessions/wbt_a/progress', {
      method: 'POST',
      body: JSON.stringify({ attempt: 1, leaseToken: 'lease-token-1234567890', chunk: { seq: 0, stream: 'status', atMs: 1 } }),
    })

    const response = await handleWorkbenchTunnelProgress(request, 'device-a', 'wbt_a', async () => identity, append)

    expect(response.status).toBe(409)
  })

  it('binds completion to the signed device, path session, attempt, and lease', async () => {
    const complete = jest.fn(async () => tunnelSession({ status: 'exited' }))
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/tunnel/sessions/wbt_a/complete', {
      method: 'POST',
      body: JSON.stringify({ attempt: 1, leaseToken: 'lease-token-1234567890', outcome: 'exited' }),
    })

    const response = await handleWorkbenchTunnelComplete(request, 'device-a', 'wbt_a', async () => identity, complete)

    expect(response.status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3, sessionId: 'wbt_a',
      attempt: 1, leaseToken: 'lease-token-1234567890', outcome: 'exited',
    }))
  })

  it('rejects an unknown outcome before touching the store', async () => {
    const complete = jest.fn()
    const request = new NextRequest('https://app.test/api/v1/linked-computers/device-a/workbench/tunnel/sessions/wbt_a/complete', {
      method: 'POST',
      body: JSON.stringify({ attempt: 1, leaseToken: 'lease-token-1234567890', outcome: 'cancelled' }),
    })

    const response = await handleWorkbenchTunnelComplete(request, 'device-a', 'wbt_a', async () => identity, complete)

    expect(response.status).toBe(400)
    expect(complete).not.toHaveBeenCalled()
  })
})
