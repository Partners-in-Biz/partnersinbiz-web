import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

const mockLoadPlatformStaffMembership = jest.fn()

jest.mock('@/lib/orgMembers/platform-staff', () => ({
  loadPlatformStaffMembership: (...args: unknown[]) => mockLoadPlatformStaffMembership(...args),
}))

import { resolveMailboxOrgIdForActor, resolvePibStaffMailboxRemap } from '@/lib/mailbox/staff-mailbox-remap'

describe('staff mailbox remap', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('remaps PiB staff client-chat orgIds onto the platform mailbox tenant', async () => {
    mockLoadPlatformStaffMembership.mockResolvedValue({
      platformOrgId: PIB_PLATFORM_ORG_ID,
      uid: 'stean',
      role: 'member',
      policy: {},
    })

    await expect(resolvePibStaffMailboxRemap({
      uid: 'stean',
      requestedOrgId: 'wS5pgwa6c9WbPocf4w0w',
    })).resolves.toEqual({
      mailboxOrgId: PIB_PLATFORM_ORG_ID,
      conversationOrgId: 'wS5pgwa6c9WbPocf4w0w',
    })

    await expect(resolveMailboxOrgIdForActor({
      uid: 'stean',
      requestedOrgId: 'wS5pgwa6c9WbPocf4w0w',
    })).resolves.toEqual({
      orgId: PIB_PLATFORM_ORG_ID,
      conversationOrgId: 'wS5pgwa6c9WbPocf4w0w',
    })
  })

  it('does not remap when already on the platform org or the actor is not PiB staff', async () => {
    mockLoadPlatformStaffMembership.mockResolvedValue({
      platformOrgId: PIB_PLATFORM_ORG_ID,
      uid: 'stean',
      role: 'member',
      policy: {},
    })
    await expect(resolvePibStaffMailboxRemap({
      uid: 'stean',
      requestedOrgId: PIB_PLATFORM_ORG_ID,
    })).resolves.toBeNull()

    mockLoadPlatformStaffMembership.mockResolvedValue(null)
    await expect(resolvePibStaffMailboxRemap({
      uid: 'client-user',
      requestedOrgId: 'wS5pgwa6c9WbPocf4w0w',
    })).resolves.toBeNull()
    await expect(resolveMailboxOrgIdForActor({
      uid: 'client-user',
      requestedOrgId: 'wS5pgwa6c9WbPocf4w0w',
    })).resolves.toEqual({ orgId: 'wS5pgwa6c9WbPocf4w0w' })
  })
})
