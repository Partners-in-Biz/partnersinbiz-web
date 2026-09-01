const mintedSets: Record<string, unknown>[] = []

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'agent_delegations') {
        return {
          doc: jest.fn(() => ({
            id: 'dlg-staff',
            set: jest.fn(async (data: Record<string, unknown>) => {
              mintedSets.push(data)
            }),
          })),
        }
      }
      if (name === 'mailbox_agent_delegations') {
        return {
          doc: jest.fn(() => ({
            id: 'mailbox-staff',
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
          doc: jest.fn((id: string) => ({
            get: jest.fn(async () => {
              if (String(id).startsWith('pib-platform-owner_')) {
                return {
                  exists: true,
                  data: () => ({
                    status: 'active',
                    role: 'member',
                    accessPolicy: {
                      preset: 'custom',
                      modules: { crm: true, billing: true, messages: true },
                      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
                      capabilities: { invoices: true, quotes: true },
                      agentRuntimeAccess: { 'vps:pib': ['pip', 'nora'] },
                      allowPersonalLlmOnOrgVps: false,
                    },
                  }),
                }
              }
              return { exists: false, data: () => undefined }
            }),
          })),
        }
      }
      return { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) }
    },
  },
}))

describe('staff dual-scope delegations', () => {
  beforeEach(() => {
    mintedSets.length = 0
  })

  it('mints conversation org plus pib-platform-owner for PiB staff', async () => {
    const { mintAgentDelegation } = await import('@/lib/api/delegations')
    const minted = await mintAgentDelegation({
      user: {
        uid: 'stean',
        role: 'client',
        orgId: 'pib-platform-owner',
        activeOrgId: 'pib-platform-owner',
        orgIds: ['pib-platform-owner'],
      },
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      agentId: 'pip',
      purpose: 'messages:conv-1',
      conversationId: 'conv-1',
    })

    expect(minted.orgIds).toEqual(['wS5pgwa6c9WbPocf4w0w', 'pib-platform-owner'])
    expect(minted.issuerOrgId).toBe('pib-platform-owner')
    expect(mintedSets[0]).toEqual(expect.objectContaining({
      orgIds: ['wS5pgwa6c9WbPocf4w0w', 'pib-platform-owner'],
      issuerOrgId: 'pib-platform-owner',
      activeOrgId: 'wS5pgwa6c9WbPocf4w0w',
      memberAccessPolicy: expect.objectContaining({
        capabilities: expect.objectContaining({ invoices: true, quotes: true }),
      }),
    }))
  })
})
