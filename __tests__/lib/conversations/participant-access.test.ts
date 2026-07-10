const users: Record<string, Record<string, unknown>> = {
  owner: { role: 'client', displayName: 'Owner' },
  member: { role: 'client', displayName: 'Member' },
  super: { role: 'admin', displayName: 'Super Admin' },
  outsider: { role: 'client', displayName: 'Outsider' },
}

jest.mock('@/lib/platform/constants', () => ({ PIB_PLATFORM_ORG_ID: 'platform-org' }))
jest.mock('@/lib/api/platformAdmin', () => ({
  isSuperAdmin: (user: { role?: string; allowedOrgIds?: string[] }) => user.role === 'admin' && !user.allowedOrgIds,
}))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'organizations') return {
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ members: [{ uid: 'outsider' }] }) }) }),
      }
      if (name === 'orgMembers') return {
        where: () => ({ get: async () => ({ docs: [
          { id: 'owner', data: () => ({ userId: 'owner' }) },
          { id: 'member', data: () => ({ uid: 'member' }) },
        ] }) }),
      }
      if (name === 'users') return {
        where: () => ({ get: async () => ({ docs: [
          { id: 'super', data: () => users.super },
        ] }) }),
        doc: (uid: string) => ({ get: async () => ({ exists: Boolean(users[uid]), data: () => users[uid] }) }),
      }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

import {
  ConversationParticipantError,
  resolveHumanConversationParticipants,
} from '@/lib/conversations/participant-access'

describe('resolveHumanConversationParticipants', () => {
  it('retains the owner, deduplicates IDs, and resolves eligible organisation members', async () => {
    await expect(resolveHumanConversationParticipants({
      orgId: 'org-1', ownerUid: 'owner', requestedUids: ['member', 'member'],
    })).resolves.toEqual([
      expect.objectContaining({ uid: 'owner', displayName: 'Owner' }),
      expect.objectContaining({ uid: 'member', displayName: 'Member' }),
    ])
  })

  it('allows platform super-admins without opening access to unrelated users', async () => {
    await expect(resolveHumanConversationParticipants({
      orgId: 'org-1', ownerUid: 'owner', requestedUids: ['super'],
    })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ uid: 'super', role: 'admin' })]))

    await expect(resolveHumanConversationParticipants({
      orgId: 'org-1', ownerUid: 'owner', requestedUids: ['outsider'],
    })).rejects.toMatchObject<Partial<ConversationParticipantError>>({ status: 403 })
  })

  it('rejects malformed participant arrays before changing access', async () => {
    await expect(resolveHumanConversationParticipants({
      orgId: 'org-1', ownerUid: 'owner', requestedUids: 'member',
    })).rejects.toMatchObject<Partial<ConversationParticipantError>>({ status: 400 })
  })

  it('does not trust stale legacy embedded organisation members', async () => {
    await expect(resolveHumanConversationParticipants({
      orgId: 'org-1', ownerUid: 'owner', requestedUids: ['outsider'],
    })).rejects.toMatchObject<Partial<ConversationParticipantError>>({ status: 403 })
  })
})
