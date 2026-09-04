import { NextRequest } from 'next/server'
import { appendSystemEvent } from '@/lib/conversations/system-events'
import { handleClickBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/click/route'
import { handleTypeBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/type/route'
import { handlePressBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/press/route'
import { handleScrollBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/scroll/route'
import { handleFollowBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/follow/route'
import { handleSnapshotBrowserSession, handleGetBrowserSnapshot } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/snapshot/route'
import { handleConsoleBrowserSession, handleGetBrowserConsole } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/console/route'
import { handleDialogBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/dialog/route'
import { handleClickRefBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/click-ref/route'
import { handleSetBrowserDriver } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/driver/route'
import { handleSetBrowserAllowPrivate } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/allow-private/route'
import type { AuthorizedWorkbenchContext } from '@/lib/messages/workbench/authorization'
import type { WorkbenchBrowserSession } from '@/lib/messages/workbench/browser-sessions'

jest.mock('@/lib/conversations/system-events', () => ({
  appendSystemEvent: jest.fn(async () => ({ id: 'evt-1' })),
}))

const user = { uid: 'user-a', role: 'client' as const, orgId: 'org-a' }
/** Only the fields these routes actually read; `conversation` is a full document in production. */
const authorization = {
  conversation: { id: 'conversation-a', orgId: 'org-a' },
  projectId: 'project-a',
  projectReplicaId: 'replica-a',
  relativeFolder: 'projects/project-a',
  binding: {
    kind: 'linked-computer',
    deviceId: 'device-a',
    runtimeTargetId: 'runtime-a',
    credentialVersion: 3,
    workspaceId: 'workspace-a',
    mappingId: 'mapping-a',
    platform: 'macos',
  },
} as unknown as AuthorizedWorkbenchContext

function session(overrides: Partial<WorkbenchBrowserSession> = {}): WorkbenchBrowserSession {
  return {
    sessionId: 'wbbs_a',
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
    startUrl: null,
    viewport: { width: 1280, height: 720 },
    initiator: 'user',
    driver: 'idle',
    allowPrivateNetwork: true,
    status: 'running',
    attempt: 1,
    approvedByUserId: 'user-a',
    approvedAtMs: 1_500,
    encryptedCreateControl: null,
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    ttlExpiresAtMs: 100_000,
    ...overrides,
  }
}

function request(body: unknown, path: string, method: 'GET' | 'POST' = 'POST', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://app.test/api/v1/conversations/conversation-a/workbench/browser/sessions/wbbs_a/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
}

/** Shared server-side binding every interaction route must derive from the conversation, never from the request body. */
const expectedBinding = {
  sessionId: 'wbbs_a',
  conversationId: 'conversation-a',
  orgId: 'org-a',
  actorUserId: 'user-a',
  deviceId: 'device-a',
  runtimeTargetId: 'runtime-a',
  credentialVersion: 3,
  workspaceId: 'workspace-a',
  mappingId: 'mapping-a',
  projectId: 'project-a',
  projectReplicaId: 'replica-a',
  relativeFolder: 'projects/project-a',
}

describe('conversation workbench browser interaction routes', () => {
  it('queues a click with a server-derived binding and a defaulted button', async () => {
    const enqueue = jest.fn(async () => session())
    const response = await handleClickBrowserSession(request({ x: 120, y: 340 }, 'click'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })

    expect(response.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith({ ...expectedBinding, x: 120, y: 340, button: 'left' })
  })

  it('rejects a click outside the viewport bounds before authorizing', async () => {
    const authorize = jest.fn(async () => authorization)
    const enqueue = jest.fn()
    const response = await handleClickBrowserSession(request({ x: 5_000, y: 10 }, 'click'), user, 'conversation-a', 'wbbs_a', {
      authorize, get: async () => session(), enqueue,
    })

    expect(response.status).toBe(400)
    expect(authorize).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('queues typed text and rejects text carrying control characters', async () => {
    const enqueue = jest.fn(async () => session())
    const accepted = await handleTypeBrowserSession(request({ text: 'hello@example.com' }, 'type'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(accepted.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith({ ...expectedBinding, text: 'hello@example.com' })

    const rejected = await handleTypeBrowserSession(request({ text: 'red \u001b[31mtext' }, 'type'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(rejected.status).toBe(400)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('queues an allowlisted key press and rejects anything else', async () => {
    const enqueue = jest.fn(async () => session())
    const accepted = await handlePressBrowserSession(request({ key: 'Enter' }, 'press'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(accepted.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith({ ...expectedBinding, key: 'Enter' })

    for (const key of ['a', 'F12', 'Meta']) {
      const rejected = await handlePressBrowserSession(request({ key }, 'press'), user, 'conversation-a', 'wbbs_a', {
        authorize: async () => authorization, get: async () => session(), enqueue,
      })
      expect(rejected.status).toBe(400)
    }
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('queues a scroll with deltaX defaulted to 0 and requires deltaY', async () => {
    const enqueue = jest.fn(async () => session())
    const accepted = await handleScrollBrowserSession(request({ x: 10, y: 20, deltaY: 400 }, 'scroll'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(accepted.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith({ ...expectedBinding, x: 10, y: 20, deltaX: 0, deltaY: 400 })

    const rejected = await handleScrollBrowserSession(request({ x: 10, y: 20 }, 'scroll'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(rejected.status).toBe(400)
  })

  it('starts following with a clamped interval, stops without one, and rejects an unknown action', async () => {
    const start = jest.fn(async () => session())
    const stop = jest.fn(async () => session())
    const dependencies = { authorize: async () => authorization, get: async () => session(), start, stop }

    await handleFollowBrowserSession(request({ action: 'start', intervalMs: 10 }, 'follow'), user, 'conversation-a', 'wbbs_a', dependencies)
    expect(start).toHaveBeenCalledWith({ ...expectedBinding, intervalMs: 500 })

    await handleFollowBrowserSession(request({ action: 'start' }, 'follow'), user, 'conversation-a', 'wbbs_a', dependencies)
    expect(start).toHaveBeenLastCalledWith({ ...expectedBinding, intervalMs: 1_000 })

    await handleFollowBrowserSession(request({ action: 'stop' }, 'follow'), user, 'conversation-a', 'wbbs_a', dependencies)
    expect(stop).toHaveBeenCalledWith(expectedBinding)

    const rejected = await handleFollowBrowserSession(request({ action: 'pause' }, 'follow'), user, 'conversation-a', 'wbbs_a', dependencies)
    expect(rejected.status).toBe(400)
    expect(start).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('hides a session owned by another actor behind a 404', async () => {
    const enqueue = jest.fn()
    const response = await handleClickBrowserSession(request({ x: 1, y: 2 }, 'click'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session({ actorUserId: 'user-b' }), enqueue,
    })

    expect(response.status).toBe(404)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('maps a not-running session to 409 and a full control queue to 429', async () => {
    const conflict = await handleClickBrowserSession(request({ x: 1, y: 2 }, 'click'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization,
      get: async () => session(),
      enqueue: async () => { throw new Error('workbench: browser session not running') },
    })
    expect(conflict.status).toBe(409)

    const throttled = await handleScrollBrowserSession(request({ x: 1, y: 2, deltaY: 10 }, 'scroll'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization,
      get: async () => session(),
      enqueue: async () => { throw new Error('workbench: browser session control queue full') },
    })
    expect(throttled.status).toBe(429)
  })
})

describe('conversation workbench browser control-plane routes', () => {
  beforeEach(() => {
    jest.mocked(appendSystemEvent).mockClear()
  })

  it('queues a snapshot request and forwards the agent actor header', async () => {
    const enqueue = jest.fn(async () => session())
    const accepted = await handleSnapshotBrowserSession(request({}, 'snapshot'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(accepted.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith({ ...expectedBinding, actorKind: undefined })

    const agentEnqueue = jest.fn(async () => session())
    const agentRequest = await handleSnapshotBrowserSession(request({}, 'snapshot', 'POST', { 'x-agent-actor': 'agent-1' }), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue: agentEnqueue,
    })
    expect(agentRequest.status).toBe(200)
    expect(agentEnqueue).toHaveBeenCalledWith({ ...expectedBinding, actorKind: 'agent' })
  })

  it('reads the latest snapshot progress chunk via GET and reports null before any capture', async () => {
    const withChunk = await handleGetBrowserSnapshot(request(null, 'snapshot', 'GET'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization,
      get: async () => session({ progressChunks: [{ seq: 3, stream: 'snapshot', atMs: 4_000, snapshot: { ax: '<button>Sign in</button>', refs: { '@e1': { role: 'button' } } } }] }),
    })
    expect(withChunk.status).toBe(200)
    expect((await withChunk.json()).data).toEqual({
      snapshot: { ax: '<button>Sign in</button>', refs: { '@e1': { role: 'button' } } },
      seq: 3,
      atMs: 4_000,
      status: 'running',
    })

    const empty = await handleGetBrowserSnapshot(request(null, 'snapshot', 'GET'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(),
    })
    expect((await empty.json()).data).toEqual({ snapshot: null, seq: 0, atMs: 0, status: 'running' })
  })

  it('queues a console ring request and reads it back via GET', async () => {
    const enqueue = jest.fn(async () => session())
    const accepted = await handleConsoleBrowserSession(request({}, 'console'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(accepted.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith({ ...expectedBinding, actorKind: undefined })

    const read = await handleGetBrowserConsole(request(null, 'console', 'GET'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization,
      get: async () => session({ progressChunks: [{ seq: 7, stream: 'console', atMs: 8_000, entries: [{ level: 'error', text: 'boom' }] }] }),
    })
    expect(read.status).toBe(200)
    expect((await read.json()).data).toEqual({ entries: [{ level: 'error', text: 'boom' }], seq: 7, atMs: 8_000, status: 'running' })

    const empty = await handleGetBrowserConsole(request(null, 'console', 'GET'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(),
    })
    expect((await empty.json()).data).toEqual({ entries: null, seq: 0, atMs: 0, status: 'running' })
  })

  it('responds to a dialog with accept and optional promptText, forwarding the agent actor header', async () => {
    const enqueue = jest.fn(async () => session())
    const accepted = await handleDialogBrowserSession(request({ accept: true }, 'dialog'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(accepted.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith({ ...expectedBinding, accept: true, actorKind: undefined })

    await handleDialogBrowserSession(request({ accept: false, promptText: 'my answer' }, 'dialog'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(enqueue).toHaveBeenLastCalledWith({ ...expectedBinding, accept: false, promptText: 'my answer', actorKind: undefined })

    const agentEnqueue = jest.fn(async () => session())
    await handleDialogBrowserSession(request({ accept: true }, 'dialog', 'POST', { 'x-agent-actor': 'agent-1' }), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue: agentEnqueue,
    })
    expect(agentEnqueue).toHaveBeenCalledWith({ ...expectedBinding, accept: true, actorKind: 'agent' })
  })

  it('rejects a dialog body without a boolean accept', async () => {
    const enqueue = jest.fn()
    for (const body of [{}, { accept: 'yes' }, { accept: 1 }, { accept: true, promptText: 'x'.repeat(1_001) }, { accept: true, promptText: 'no\u0007bell' }]) {
      const rejected = await handleDialogBrowserSession(request(body, 'dialog'), user, 'conversation-a', 'wbbs_a', {
        authorize: async () => authorization, get: async () => session(), enqueue,
      })
      expect(rejected.status).toBe(400)
    }
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('clicks by accessibility ref, normalizing a bare ref to @-prefixed', async () => {
    const enqueue = jest.fn(async () => session())
    const accepted = await handleClickRefBrowserSession(request({ ref: 'e12' }, 'click-ref'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue,
    })
    expect(accepted.status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith({ ...expectedBinding, ref: '@e12', actorKind: undefined })

    const agentEnqueue = jest.fn(async () => session())
    await handleClickRefBrowserSession(request({ ref: '@e3' }, 'click-ref', 'POST', { 'x-agent-actor': 'agent-1' }), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), enqueue: agentEnqueue,
    })
    expect(agentEnqueue).toHaveBeenCalledWith({ ...expectedBinding, ref: '@e3', actorKind: 'agent' })
  })

  it('rejects a click-ref with a malformed ref before authorizing', async () => {
    const authorize = jest.fn(async () => authorization)
    const enqueue = jest.fn()
    for (const ref of ['a.b', 'a b', '', 'x'.repeat(33)]) {
      const rejected = await handleClickRefBrowserSession(request({ ref }, 'click-ref'), user, 'conversation-a', 'wbbs_a', {
        authorize, get: async () => session(), enqueue,
      })
      expect(rejected.status).toBe(400)
    }
    expect(authorize).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('hands the wheel to user or agent, forwarding the agent actor header', async () => {
    const set = jest.fn(async () => session())
    const agentTakeover = await handleSetBrowserDriver(request({ driver: 'agent' }, 'driver', 'POST', { 'x-agent-actor': 'agent-1' }), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), set,
    })
    expect(agentTakeover.status).toBe(200)
    expect(set).toHaveBeenCalledWith({ ...expectedBinding, driver: 'agent', actorKind: 'agent' })

    await handleSetBrowserDriver(request({ driver: 'user' }, 'driver'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), set,
    })
    expect(set).toHaveBeenLastCalledWith({ ...expectedBinding, driver: 'user', actorKind: undefined })
    expect(appendSystemEvent).toHaveBeenCalledWith(expect.objectContaining({
      convId: 'conversation-a',
      event: expect.objectContaining({ eventKind: 'driver.take_control' }),
    }))
  })

  it('appends a hand-back system event for the Messages UI (no X-Agent-Actor)', async () => {
    const set = jest.fn(async () => session({ driver: 'agent' }))
    const res = await handleSetBrowserDriver(request({ driver: 'agent' }, 'driver'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session({ driver: 'user' }), set,
    })
    expect(res.status).toBe(200)
    expect(appendSystemEvent).toHaveBeenCalledWith(expect.objectContaining({
      convId: 'conversation-a',
      event: expect.objectContaining({ eventKind: 'driver.hand_back', actorKind: 'user' }),
    }))
  })

  it('does not append a system event when an agent sets the driver', async () => {
    const set = jest.fn(async () => session())
    await handleSetBrowserDriver(request({ driver: 'agent' }, 'driver', 'POST', { 'x-agent-actor': 'agent-1' }), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), set,
    })
    expect(appendSystemEvent).not.toHaveBeenCalled()
  })

  it('rejects an unknown driver and maps an agent takeover of an active user session to 409', async () => {
    const set = jest.fn()
    const rejected = await handleSetBrowserDriver(request({ driver: 'robot' }, 'driver'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), set,
    })
    expect(rejected.status).toBe(400)
    expect(set).not.toHaveBeenCalled()

    const conflict = await handleSetBrowserDriver(request({ driver: 'agent' }, 'driver', 'POST', { 'x-agent-actor': 'agent-1' }), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization,
      get: async () => session({ driver: 'user' }),
      set: async () => { throw new Error('workbench: browser session is being driven by the user') },
    })
    expect(conflict.status).toBe(409)
  })

  it('lets the human toggle private-network access and rejects an agent self-grant with 403', async () => {
    const set = jest.fn(async () => session())
    const allowed = await handleSetBrowserAllowPrivate(request({ allow: true }, 'allow-private'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), set,
    })
    expect(allowed.status).toBe(200)
    expect(set).toHaveBeenCalledWith({ ...expectedBinding, allow: true })

    await handleSetBrowserAllowPrivate(request({ allow: false }, 'allow-private'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), set,
    })
    expect(set).toHaveBeenLastCalledWith({ ...expectedBinding, allow: false })

    const authorize = jest.fn(async () => authorization)
    const agentSet = jest.fn()
    const denied = await handleSetBrowserAllowPrivate(request({ allow: true }, 'allow-private', 'POST', { 'x-agent-actor': 'agent-1' }), user, 'conversation-a', 'wbbs_a', {
      authorize, get: async () => session(), set: agentSet,
    })
    expect(denied.status).toBe(403)
    expect(authorize).not.toHaveBeenCalled()
    expect(agentSet).not.toHaveBeenCalled()
  })

  it('rejects a non-boolean allow value', async () => {
    const set = jest.fn()
    const rejected = await handleSetBrowserAllowPrivate(request({ allow: 'yes' }, 'allow-private'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session(), set,
    })
    expect(rejected.status).toBe(400)
    expect(set).not.toHaveBeenCalled()
  })

  it('hides a session owned by another actor behind a 404 on the new routes', async () => {
    const enqueue = jest.fn()
    const response = await handleSnapshotBrowserSession(request({}, 'snapshot'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session({ actorUserId: 'user-b' }), enqueue,
    })
    expect(response.status).toBe(404)
    expect(enqueue).not.toHaveBeenCalled()

    const read = await handleGetBrowserSnapshot(request(null, 'snapshot', 'GET'), user, 'conversation-a', 'wbbs_a', {
      authorize: async () => authorization, get: async () => session({ actorUserId: 'user-b' }),
    })
    expect(read.status).toBe(404)
  })
})
