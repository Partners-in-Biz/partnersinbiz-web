/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const MOCK_USER: ApiUser = {
  uid: 'member-1',
  orgId: 'org-1',
  orgIds: ['org-1'],
  role: 'client',
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, ctx?: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx?: unknown) => handler(req, MOCK_USER, ctx),
}))

const clientCanAccessOrg = jest.fn(() => true)
const canWriteOrgLlmConnection = jest.fn(async () => false)
jest.mock('@/lib/llm-providers/org-guard', () => ({
  clientCanAccessOrg: (...args: unknown[]) => clientCanAccessOrg(...args as []),
  canWriteOrgLlmConnection: (...args: unknown[]) => canWriteOrgLlmConnection(...args as []),
}))

const getLlmProviderConnection = jest.fn()
jest.mock('@/lib/llm-providers/store', () => ({
  getLlmProviderConnection: (...args: unknown[]) => getLlmProviderConnection(...args as []),
}))

const listConnectionLlmCredentialBindings = jest.fn()
jest.mock('@/lib/llm-providers/bindings', () => ({
  listConnectionLlmCredentialBindings: (...args: unknown[]) => listConnectionLlmCredentialBindings(...args as []),
}))

const listOwnedDevices = jest.fn()
jest.mock('@/lib/linked-computers/store', () => ({
  listOwnedDevices: (...args: unknown[]) => listOwnedDevices(...args as []),
}))

import { GET } from '@/app/api/v1/llm-providers/connections/[id]/bindings/route'

const ctx = { params: Promise.resolve({ id: 'conn-1' }) }

describe('GET /api/v1/llm-providers/connections/[id]/bindings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    MOCK_USER.uid = 'member-1'
    clientCanAccessOrg.mockReturnValue(true)
    canWriteOrgLlmConnection.mockResolvedValue(false)
    getLlmProviderConnection.mockResolvedValue({
      id: 'conn-1',
      orgId: 'org-1',
      scope: 'org',
    })
    listConnectionLlmCredentialBindings.mockResolvedValue([
      { deviceId: 'device-mine', machineLabel: 'My Mac', agentId: 'partners--pip', status: 'ready' },
      { deviceId: 'device-other', machineLabel: 'Other Mac', agentId: 'partners--pip', status: 'ready' },
    ])
    listOwnedDevices.mockResolvedValue([{ deviceId: 'device-mine' }])
  })

  it('filters bindings to the caller\'s own devices for non-admins', async () => {
    const res = await GET(new NextRequest('http://localhost/api/v1/llm-providers/connections/conn-1?orgId=org-1'), ctx)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        bindings: [{ deviceId: 'device-mine', machineLabel: 'My Mac', agentId: 'partners--pip', status: 'ready' }],
      },
    })
    expect(listOwnedDevices).toHaveBeenCalledWith('member-1')
  })

  it('returns every binding for an org admin', async () => {
    canWriteOrgLlmConnection.mockResolvedValue(true)
    const res = await GET(new NextRequest('http://localhost/api/v1/llm-providers/connections/conn-1?orgId=org-1'), ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { bindings: unknown[] } }
    expect(body.data.bindings).toHaveLength(2)
    expect(listOwnedDevices).not.toHaveBeenCalled()
  })
})
