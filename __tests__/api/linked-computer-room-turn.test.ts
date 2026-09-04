/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

const identity = { deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 3 }

const mockAppend = jest.fn()
const mockGetConversation = jest.fn()
const mockGetAgentRoomById = jest.fn()
const mockOrgFeatureFlagEnabled = jest.fn(async () => true)
const mockDeviceGet = jest.fn()

jest.mock('@/lib/conversations/append-agent-message', () => ({
  appendAgentMessage: (...args: unknown[]) => mockAppend(...args),
  AppendAgentMessageError: class AppendAgentMessageError extends Error {
    constructor(message: string, public readonly status: number) {
      super(message)
      this.name = 'AppendAgentMessageError'
    }
  },
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
}))

jest.mock('@/lib/agent-rooms/store', () => ({
  getAgentRoomById: (...args: unknown[]) => mockGetAgentRoomById(...args),
}))

jest.mock('@/lib/organizations/feature-flags', () => ({
  orgFeatureFlagEnabled: (...args: unknown[]) => mockOrgFeatureFlagEnabled(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: () => mockDeviceGet(),
      }),
    }),
  },
}))

import { handleRelayRoomTurn } from '@/app/api/v1/linked-computers/[deviceId]/relay/room-turn/route'

describe('POST /api/v1/linked-computers/[deviceId]/relay/room-turn', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgFeatureFlagEnabled.mockResolvedValue(true)
    mockGetAgentRoomById.mockResolvedValue({
      roomId: 'org-1_growth-desk',
      orgId: 'org-1',
      status: 'active',
      conversationId: 'conv-room-1',
      members: [{ agentId: 'maya', deviceId: 'device-a' }],
      humanTeamIds: ['org-1_growth'],
    })
    mockGetConversation.mockResolvedValue({
      id: 'conv-room-1',
      orgId: 'org-1',
      participantAgentIds: ['maya', 'pip'],
    })
    mockDeviceGet.mockResolvedValue({
      exists: true,
      data: () => ({ label: "Peet's Mac" }),
    })
    mockAppend.mockResolvedValue({
      id: 'msg-room-1',
      authorId: 'agent:maya',
      dispatchAgentId: 'maya',
      deviceBadge: { deviceId: 'device-a', label: "Peet's Mac" },
    })
  })

  it('appends a room turn attributed to the profile agent with a device badge', async () => {
    const req = new NextRequest('https://app.test/api/v1/linked-computers/device-a/relay/room-turn', {
      method: 'POST',
      body: JSON.stringify({
        roomId: 'org-1_growth-desk',
        profile: 'partners--maya',
        text: 'Draft is ready.',
      }),
    })
    const response = await handleRelayRoomTurn(req, 'device-a', async () => identity)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        message: {
          authorId: 'agent:maya',
          dispatchAgentId: 'maya',
          deviceBadge: { deviceId: 'device-a', label: "Peet's Mac" },
        },
      },
    })
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      convId: 'conv-room-1',
      agentId: 'maya',
      content: 'Draft is ready.',
      deviceBadge: { deviceId: 'device-a', label: "Peet's Mac" },
    }))
  })

  it('returns 403 not_teammates when the device is not a room member', async () => {
    mockGetAgentRoomById.mockResolvedValue({
      roomId: 'org-1_growth-desk',
      orgId: 'org-1',
      status: 'active',
      conversationId: 'conv-room-1',
      members: [{ agentId: 'maya', deviceId: 'device-b' }],
    })
    const req = new NextRequest('https://app.test/api/v1/linked-computers/device-a/relay/room-turn', {
      method: 'POST',
      body: JSON.stringify({
        roomId: 'org-1_growth-desk',
        profile: 'partners--maya',
        text: 'hello',
      }),
    })
    const response = await handleRelayRoomTurn(req, 'device-a', async () => identity)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ reason: 'not_teammates' })
    expect(mockAppend).not.toHaveBeenCalled()
  })
})
