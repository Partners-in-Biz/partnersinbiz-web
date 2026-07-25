import { NextRequest } from 'next/server'
import { handleClickBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/click/route'
import { handleTypeBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/type/route'
import { handlePressBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/press/route'
import { handleScrollBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/scroll/route'
import { handleFollowBrowserSession } from '@/app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/follow/route'
import type { AuthorizedWorkbenchContext } from '@/lib/messages/workbench/authorization'
import type { WorkbenchBrowserSession } from '@/lib/messages/workbench/browser-sessions'

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

function request(body: unknown, path: string): NextRequest {
  return new NextRequest(`https://app.test/api/v1/conversations/conversation-a/workbench/browser/sessions/wbbs_a/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
