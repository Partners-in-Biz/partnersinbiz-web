import { createHash } from 'node:crypto'

const lookupDocs: Array<{ id: string; data: () => Record<string, unknown> }> = []
const mintedSets: Record<string, unknown>[] = []

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'agent_delegations') {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({
                empty: lookupDocs.length === 0,
                docs: lookupDocs,
              })),
            })),
          })),
          doc: jest.fn(() => ({
            id: 'dlg-reminted',
            set: jest.fn(async (data: Record<string, unknown>) => {
              mintedSets.push(data)
            }),
            update: jest.fn(),
          })),
        }
      }
      if (name === 'mailbox_agent_delegations') {
        return {
          doc: jest.fn(() => ({
            id: 'mailbox-reminted',
            set: jest.fn(async () => undefined),
          })),
        }
      }
      if (name === 'organizations') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({ exists: true, data: () => ({ settings: {} }) })),
          })),
        }
      }
      if (name === 'orgMembers') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({ exists: false, data: () => undefined })),
          })),
        }
      }
      return { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) }
    },
  },
}))

describe('remintExpiredMessagesDelegation', () => {
  beforeEach(() => {
    lookupDocs.length = 0
    mintedSets.length = 0
    process.env.AI_API_KEY = 'legacy-god-key'
  })

  it('remints a messages-purpose expired dlg through the system-auth mint path', async () => {
    const rawToken = 'pib_dlg_expired_secret'
    lookupDocs.push({
      id: 'dlg-old',
      data: () => ({
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        actingForUserId: 'staff-1',
        agentId: 'pip',
        role: 'admin',
        orgId: 'org-1',
        activeOrgId: 'org-1',
        orgIds: ['org-1'],
        purpose: 'messages:conv-1',
        conversationId: 'conv-1',
        status: 'active',
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    })

    const { remintExpiredMessagesDelegation } = await import('@/lib/api/delegations')
    const minted = await remintExpiredMessagesDelegation(rawToken)

    expect(minted).not.toBeNull()
    expect(minted?.token.startsWith('pib_dlg_')).toBe(true)
    expect(minted?.token).not.toBe('legacy-god-key')
    expect(minted?.token).not.toBe(rawToken)
    expect(minted?.actingForUserId).toBe('staff-1')
    expect(minted?.agentId).toBe('pip')
    expect(mintedSets).toHaveLength(1)
    expect(mintedSets[0]).toEqual(expect.objectContaining({
      actingForUserId: 'staff-1',
      agentId: 'pip',
      purpose: 'messages:conv-1',
      conversationId: 'conv-1',
      status: 'active',
    }))
  })

  it('does not remint revoked tokens and does not return AI_API_KEY', async () => {
    const rawToken = 'pib_dlg_revoked'
    lookupDocs.push({
      id: 'dlg-revoked',
      data: () => ({
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        actingForUserId: 'staff-1',
        agentId: 'pip',
        role: 'admin',
        orgId: 'org-1',
        purpose: 'messages:conv-1',
        status: 'active',
        revokedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    })

    const { remintExpiredMessagesDelegation } = await import('@/lib/api/delegations')
    const minted = await remintExpiredMessagesDelegation(rawToken)
    expect(minted).toBeNull()
    expect(mintedSets).toHaveLength(0)
  })
})
