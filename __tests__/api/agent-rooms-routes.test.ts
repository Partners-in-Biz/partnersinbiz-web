/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const MOCK_USER: ApiUser = {
  uid: 'admin-1',
  orgId: 'org-1',
  orgIds: ['org-1'],
  role: 'client',
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, ctx?: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx?: unknown) => handler(req, MOCK_USER, ctx),
}))

const clientCanAccessOrg = jest.fn(() => true)
jest.mock('@/lib/llm-providers/org-guard', () => ({
  clientCanAccessOrg: (...args: unknown[]) => clientCanAccessOrg(...args as []),
}))

const orgFeatureFlagEnabled = jest.fn(async () => true)
jest.mock('@/lib/organizations/feature-flags', () => ({
  orgFeatureFlagEnabled: (...args: unknown[]) => orgFeatureFlagEnabled(...args as []),
}))

const assertCanManageAgentRooms = jest.fn(async () => undefined)
const assertCanManageAgentRoom = jest.fn(async () => undefined)
const assertCanCreateAgentRoom = jest.fn(async () => undefined)
const createAgentRoomWithMirror = jest.fn(async (input: { slug: string; accessScope?: string }) => ({
  roomId: input.accessScope === 'personal' ? `org-1_u_admin-1_${input.slug}` : `org-1_${input.slug}`,
  slug: input.slug,
  status: 'active',
  accessScope: input.accessScope ?? 'organization',
}))
const archiveAgentRoomWithMirror = jest.fn(async () => ({
  roomId: 'org-1_growth-desk',
  status: 'archived',
}))
const updateAgentRoomWithMirror = jest.fn(async () => ({
  roomId: 'org-1_growth-desk',
  name: 'Growth desk 2',
}))
jest.mock('@/lib/agent-rooms/service', () => ({
  assertCanManageAgentRooms: (...args: unknown[]) => assertCanManageAgentRooms(...args as []),
  assertCanManageAgentRoom: (...args: unknown[]) => assertCanManageAgentRoom(...args as []),
  assertCanCreateAgentRoom: (...args: unknown[]) => assertCanCreateAgentRoom(...args as []),
  createAgentRoomWithMirror: (...args: unknown[]) => createAgentRoomWithMirror(...args as []),
  archiveAgentRoomWithMirror: (...args: unknown[]) => archiveAgentRoomWithMirror(...args as []),
  updateAgentRoomWithMirror: (...args: unknown[]) => updateAgentRoomWithMirror(...args as []),
}))

const listAgentRooms = jest.fn(async () => [{ roomId: 'org-1_growth-desk', name: 'Growth desk' }])
const getAgentRoom = jest.fn(async () => ({
  roomId: 'org-1_growth-desk',
  orgId: 'org-1',
  status: 'active',
  accessScope: 'organization',
  ownerUserId: null,
}))
jest.mock('@/lib/agent-rooms/store', () => ({
  listAgentRooms: (...args: unknown[]) => listAgentRooms(...args as []),
  getAgentRoom: (...args: unknown[]) => getAgentRoom(...args as []),
}))

const adoptProjectionDrift = jest.fn(async () => ({
  projection: { profile: 'partners--maya', driftedAt: null },
  roomIds: ['org-1_growth-desk'],
}))
const revertProjectionDrift = jest.fn(async () => ({
  projection: { profile: 'partners--maya', desiredHash: 'abc' },
  jobId: 'job-1',
}))
jest.mock('@/lib/agent-rooms/projection', () => ({
  adoptProjectionDrift: (...args: unknown[]) => adoptProjectionDrift(...args as []),
  revertProjectionDrift: (...args: unknown[]) => revertProjectionDrift(...args as []),
}))

import { GET, POST } from '@/app/api/v1/orgs/[orgId]/agent-rooms/route'
import { PATCH, DELETE } from '@/app/api/v1/orgs/[orgId]/agent-rooms/[roomId]/route'
import { POST as ADOPT } from '@/app/api/v1/orgs/[orgId]/agent-rooms/drift/[projectionId]/adopt/route'
import { POST as REVERT } from '@/app/api/v1/orgs/[orgId]/agent-rooms/drift/[projectionId]/revert/route'

function request(url: string, init?: RequestInit) {
  return new NextRequest(url, init)
}

const ctx = { params: Promise.resolve({ orgId: 'org-1', roomId: 'org-1_growth-desk', projectionId: 'device-a_partners--maya' }) }

describe('agent room routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clientCanAccessOrg.mockReturnValue(true)
    orgFeatureFlagEnabled.mockResolvedValue(true)
    assertCanManageAgentRooms.mockResolvedValue(undefined)
    assertCanManageAgentRoom.mockResolvedValue(undefined)
    assertCanCreateAgentRoom.mockResolvedValue(undefined)
    MOCK_USER.uid = 'admin-1'
  })

  it('lists rooms filtered by viewer', async () => {
    const res = await GET(request('http://localhost/api/v1/orgs/org-1/agent-rooms'), ctx)
    expect(res.status).toBe(200)
    expect(listAgentRooms).toHaveBeenCalledWith('org-1', { viewerUserId: 'admin-1' })
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { rooms: [{ roomId: 'org-1_growth-desk' }] },
    })
  })

  it('returns 404 when the flag is off', async () => {
    orgFeatureFlagEnabled.mockResolvedValue(false)
    const res = await GET(request('http://localhost/api/v1/orgs/org-1/agent-rooms'), ctx)
    expect(res.status).toBe(404)
  })

  it('forbids a caller who cannot access the org', async () => {
    clientCanAccessOrg.mockReturnValue(false)
    const res = await GET(request('http://localhost/api/v1/orgs/org-1/agent-rooms'), ctx)
    expect(res.status).toBe(403)
  })

  it('creates an org room for an admin', async () => {
    const res = await POST(request('http://localhost/api/v1/orgs/org-1/agent-rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'growth-desk',
        name: 'Growth desk',
        members: [{ agentId: 'pip', deviceId: null }, { agentId: 'maya', deviceId: 'device-a' }],
      }),
    }), ctx)
    expect(res.status).toBe(201)
    expect(assertCanCreateAgentRoom).toHaveBeenCalledWith(MOCK_USER, 'org-1', 'organization')
    expect(createAgentRoomWithMirror).toHaveBeenCalledWith(expect.objectContaining({
      accessScope: 'organization',
    }))
  })

  it('creates a personal room when accessScope is personal', async () => {
    MOCK_USER.uid = 'user-1'
    const res = await POST(request('http://localhost/api/v1/orgs/org-1/agent-rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'desk',
        name: 'My desk',
        accessScope: 'personal',
        members: [{ agentId: 'pip', deviceId: null }, { agentId: 'maya', deviceId: null }],
      }),
    }), ctx)
    expect(res.status).toBe(201)
    expect(assertCanCreateAgentRoom).toHaveBeenCalledWith(MOCK_USER, 'org-1', 'personal')
    expect(createAgentRoomWithMirror).toHaveBeenCalledWith(expect.objectContaining({
      accessScope: 'personal',
    }))
  })

  it('rejects a create when assertCanCreateAgentRoom fails', async () => {
    assertCanCreateAgentRoom.mockRejectedValue(new Error('agent rooms: administrator required'))
    const res = await POST(request('http://localhost/api/v1/orgs/org-1/agent-rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'growth-desk', name: 'Growth desk', members: [] }),
    }), ctx)
    expect(res.status).toBe(403)
    expect(createAgentRoomWithMirror).not.toHaveBeenCalled()
  })

  it('forbids PATCH when the caller cannot manage the room', async () => {
    assertCanManageAgentRoom.mockRejectedValue(new Error('agent rooms: room owner required'))
    const res = await PATCH(request('http://localhost/api/v1/orgs/org-1/agent-rooms/org-1_growth-desk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    }), ctx)
    expect(res.status).toBe(403)
    expect(updateAgentRoomWithMirror).not.toHaveBeenCalled()
  })

  it('archives a room on DELETE', async () => {
    const res = await DELETE(request('http://localhost/api/v1/orgs/org-1/agent-rooms/org-1_growth-desk'), ctx)
    expect(res.status).toBe(200)
    expect(assertCanManageAgentRoom).toHaveBeenCalled()
    expect(archiveAgentRoomWithMirror).toHaveBeenCalledWith({
      orgId: 'org-1',
      roomId: 'org-1_growth-desk',
      actorUserId: 'admin-1',
    })
  })

  it('patches a room name via updateAgentRoomWithMirror', async () => {
    const res = await PATCH(request('http://localhost/api/v1/orgs/org-1/agent-rooms/org-1_growth-desk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Growth desk 2' }),
    }), ctx)
    expect(res.status).toBe(200)
    expect(updateAgentRoomWithMirror).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      roomId: 'org-1_growth-desk',
      name: 'Growth desk 2',
      actorUserId: 'admin-1',
    }))
  })

  it('adopts drift for an org admin when the flag is on', async () => {
    const res = await ADOPT(request('http://localhost/api/v1/orgs/org-1/agent-rooms/drift/device-a_partners--maya/adopt', {
      method: 'POST',
    }), ctx)
    expect(res.status).toBe(200)
    expect(adoptProjectionDrift).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectionId: 'device-a_partners--maya',
      actorUserId: 'admin-1',
    })
  })

  it('reverts drift for an org admin when the flag is on', async () => {
    const res = await REVERT(request('http://localhost/api/v1/orgs/org-1/agent-rooms/drift/device-a_partners--maya/revert', {
      method: 'POST',
    }), ctx)
    expect(res.status).toBe(200)
    expect(revertProjectionDrift).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectionId: 'device-a_partners--maya',
      actorUserId: 'admin-1',
    })
  })

  it('returns 404 on adopt when the flag is off', async () => {
    orgFeatureFlagEnabled.mockResolvedValue(false)
    const res = await ADOPT(request('http://localhost/api/v1/orgs/org-1/agent-rooms/drift/device-a_partners--maya/adopt', {
      method: 'POST',
    }), ctx)
    expect(res.status).toBe(404)
    expect(adoptProjectionDrift).not.toHaveBeenCalled()
  })
})
