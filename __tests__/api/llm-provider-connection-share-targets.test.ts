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
const updateLlmConnectionShareTargets = jest.fn()
jest.mock('@/lib/llm-providers/store', () => ({
  getLlmProviderConnection: (...args: unknown[]) => getLlmProviderConnection(...args as []),
  revokeLlmProviderConnection: jest.fn(),
  canManageLlmConnection: jest.fn(),
  updateLlmConnectionShareTargets: (...args: unknown[]) => updateLlmConnectionShareTargets(...args as []),
}))

jest.mock('@/lib/llm-providers/sync-hermes', () => ({
  syncLlmConnectionToHermes: jest.fn(),
}))

jest.mock('@/lib/agents/team', () => ({
  callAgentPath: jest.fn(),
}))

jest.mock('@/lib/llm-providers/linked-delivery', () => ({
  enqueueCredentialRevocations: jest.fn(),
}))

const reconcileShareBindingsForConnection = jest.fn()
jest.mock('@/lib/llm-providers/share-cascade', () => ({
  reconcileShareBindingsForConnection: (...args: unknown[]) => reconcileShareBindingsForConnection(...args as []),
}))

jest.mock('@/lib/org-teams/store', () => ({
  getOrgTeam: jest.fn(),
}))

import { PATCH } from '@/app/api/v1/llm-providers/connections/[id]/route'

const ctx = { params: Promise.resolve({ id: 'conn-1' }) }

function patchRequest() {
  return new NextRequest('http://localhost/api/v1/llm-providers/connections/conn-1?orgId=org-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      shareTargets: {
        mode: 'organization',
        teamIds: [],
        userIds: [],
        agentIds: [],
        requireActiveDeviceGrant: true,
      },
    }),
  })
}

describe('PATCH /api/v1/llm-providers/connections/[id] shareTargets', () => {
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
  })

  it('returns 403 when a non-admin patches shareTargets', async () => {
    const res = await PATCH(patchRequest(), ctx)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: 'Only organisation admins can update organisation credential sharing.',
    })
    expect(updateLlmConnectionShareTargets).not.toHaveBeenCalled()
    expect(reconcileShareBindingsForConnection).not.toHaveBeenCalled()
  })
})
