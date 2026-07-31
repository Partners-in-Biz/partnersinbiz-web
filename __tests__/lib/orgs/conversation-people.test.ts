import type { ApiUser } from '@/lib/api/types'

const mockCollection = jest.fn()
const mockGetOrgChatVisibilityPolicy = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: Parameters<typeof mockCollection>) => mockCollection(...args),
  },
}))

jest.mock('@/lib/conversations/chat-config', () => ({
  getOrgChatVisibilityPolicy: (...args: Parameters<typeof mockGetOrgChatVisibilityPolicy>) => mockGetOrgChatVisibilityPolicy(...args),
}))

const usersById: Record<string, { role?: string; email?: string; displayName?: string; allowedOrgIds?: string[] }> = {
  'admin-platform': { role: 'admin', email: 'platform@acme.test', displayName: 'Platform Admin' },
  'member-admin': { role: 'admin', email: 'owner@acme.test', displayName: 'Org Owner', allowedOrgIds: ['org-1'] },
  'restricted-admin': { role: 'admin', email: 'restricted@acme.test', displayName: 'Restricted Admin', allowedOrgIds: ['org-2'] },
  'member-2': { role: 'client', email: 'member@acme.test', displayName: 'Member' },
  'member-caller': { role: 'client', email: 'caller@acme.test', displayName: 'Caller' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetOrgChatVisibilityPolicy.mockResolvedValue({
    enableClientToAdminChat: false,
    enableClientToPiBTeamChat: false,
  })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') {
      return {
        doc: (orgId: string) => ({
          get: async () => ({
            exists: true,
            data: () => ({
              members: [
                { userId: 'member-admin', role: 'owner' },
                { userId: 'member-2', role: 'member' },
                { userId: 'member-caller', role: 'member' },
              ],
            }),
          }),
        }),
      }
    }

    if (name === 'users') {
      return {
        where: () => ({
          get: async () => ({
            docs: Object.entries(usersById)
              .filter(([, data]) => data.role === 'admin')
              .map(([id, data]) => ({ id, data: () => ({ ...data }) })),
          }),
        }),
        doc: (uid: string) => ({
          get: async () => ({
            exists: !!usersById[uid],
            data: () => usersById[uid] ?? {},
          }),
        }),
      }
    }

    if (name === 'orgMembers') {
      return {
        where: () => ({
          get: async () => ({ docs: [] }),
        }),
      }
    }

    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('listConversationPeople', () => {
  it('hides org admins and PiB team users from client pickers when policy is restrictive', async () => {
    const { listConversationPeople } = await import('@/lib/orgs/conversation-people')

    const user: ApiUser = {
      uid: 'member-caller',
      role: 'client',
      orgId: 'org-1',
      orgIds: ['org-1'],
    }

    const result = await listConversationPeople('org-1', user)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.people).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uid: 'member-2', role: 'client', email: 'member@acme.test' }),
      ]),
    )
    expect(result.people).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uid: 'member-admin', role: 'admin' }),
        expect.objectContaining({ uid: 'admin-platform', role: 'admin' }),
      ]),
    )
  })

  it('includes org admins and PiB team users for clients when the policy allows it', async () => {
    mockGetOrgChatVisibilityPolicy.mockResolvedValueOnce({
      enableClientToAdminChat: true,
      enableClientToPiBTeamChat: true,
    })

    const { listConversationPeople } = await import('@/lib/orgs/conversation-people')

    const user: ApiUser = {
      uid: 'member-caller',
      role: 'client',
      orgId: 'org-1',
      orgIds: ['org-1'],
    }

    const result = await listConversationPeople('org-1', user)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.people).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uid: 'member-admin', role: 'admin', email: 'owner@acme.test' }),
        expect.objectContaining({ uid: 'admin-platform', role: 'admin', email: 'platform@acme.test' }),
        expect.objectContaining({ uid: 'member-2', role: 'client', email: 'member@acme.test' }),
      ]),
    )
  })

  it('skips the caller when listing people for them', async () => {
    mockGetOrgChatVisibilityPolicy.mockResolvedValueOnce({
      enableClientToAdminChat: true,
      enableClientToPiBTeamChat: true,
    })

    const { listConversationPeople } = await import('@/lib/orgs/conversation-people')

    const user: ApiUser = {
      uid: 'member-caller',
      role: 'client',
      orgId: 'org-1',
      orgIds: ['org-1'],
    }

    const result = await listConversationPeople('org-1', user)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.people.some((person) => person.uid === 'member-caller')).toBe(false)
  })
})
