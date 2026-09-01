import type { ApiUser } from '@/lib/api/types'
import {
  agentMailboxContextFromBody,
  agentMailboxContextFromRequest,
  resolveAgentMailboxContextFromBody,
  resolveAgentMailboxContextFromRequest,
} from '@/app/api/v1/agent/email/_shared'
import { NextRequest } from 'next/server'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

const mockLoadPlatformStaffMembership = jest.fn()

jest.mock('@/lib/orgMembers/platform-staff', () => ({
  loadPlatformStaffMembership: (...args: unknown[]) => mockLoadPlatformStaffMembership(...args),
}))

describe('agent mailbox context uid scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadPlatformStaffMembership.mockResolvedValue(null)
  })

  it('forces user-delegation calls onto the acting user even if another uid is supplied', () => {
    const user: ApiUser = {
      uid: 'user-1',
      role: 'client',
      authKind: 'user_delegation',
      actingForUserId: 'user-1',
      agentId: 'pip',
      orgId: 'org-1',
    }

    expect(agentMailboxContextFromBody({ orgId: 'org-1', uid: 'user-2' }, user)).toEqual({
      orgId: 'org-1',
      uid: 'user-1',
    })

    const req = new NextRequest('http://localhost/api/v1/agent/email/accounts?orgId=org-1&uid=user-2')
    expect(agentMailboxContextFromRequest(req, user)).toMatchObject({
      orgId: 'org-1',
      uid: 'user-1',
    })
  })

  it('remaps PiB staff mailbox orgId from a client chat onto the platform tenant', async () => {
    mockLoadPlatformStaffMembership.mockResolvedValue({
      platformOrgId: PIB_PLATFORM_ORG_ID,
      uid: 'stean',
      role: 'member',
      policy: {},
    })
    const user: ApiUser = {
      uid: 'stean',
      role: 'client',
      authKind: 'user_delegation',
      actingForUserId: 'stean',
      agentId: 'pip',
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      orgIds: ['wS5pgwa6c9WbPocf4w0w', PIB_PLATFORM_ORG_ID],
    }

    await expect(resolveAgentMailboxContextFromBody({
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      uid: 'stean',
    }, user)).resolves.toEqual({
      orgId: PIB_PLATFORM_ORG_ID,
      uid: 'stean',
      conversationOrgId: 'wS5pgwa6c9WbPocf4w0w',
    })

    const req = new NextRequest(
      'http://localhost/api/v1/agent/email/messages?orgId=wS5pgwa6c9WbPocf4w0w&uid=stean',
    )
    await expect(resolveAgentMailboxContextFromRequest(req, user)).resolves.toMatchObject({
      orgId: PIB_PLATFORM_ORG_ID,
      uid: 'stean',
      conversationOrgId: 'wS5pgwa6c9WbPocf4w0w',
    })
  })
})
