const mintedSets: Record<string, unknown>[] = []
const mockStaffCanServe = jest.fn()
const conversationDocs: Record<string, Record<string, unknown>> = {}

jest.mock('@/lib/auth/staff-client-org', () => ({
  pibStaffCanServeClientOrg: (...args: unknown[]) => mockStaffCanServe(...args),
}))

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
      if (name === 'conversations') {
        return {
          doc: jest.fn((id: string) => ({
            get: jest.fn(async () => {
              const data = conversationDocs[id]
              return data
                ? { exists: true, id, data: () => data }
                : { exists: false, data: () => undefined }
            }),
          })),
        }
      }
      return { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) }
    },
  },
}))

describe('staff dual-scope delegations', () => {
  const stean = {
    uid: 'stean',
    role: 'client' as const,
    orgId: 'pib-platform-owner',
    activeOrgId: 'pib-platform-owner',
    orgIds: ['pib-platform-owner'],
  }

  beforeEach(() => {
    mintedSets.length = 0
    Object.keys(conversationDocs).forEach((key) => { delete conversationDocs[key] })
    mockStaffCanServe.mockReset()
    mockStaffCanServe.mockResolvedValue(false)
  })

  it('mints conversation org plus pib-platform-owner for PiB staff', async () => {
    conversationDocs['conv-1'] = {
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      participantUids: ['stean'],
    }
    const { mintAgentDelegation } = await import('@/lib/api/delegations')
    const minted = await mintAgentDelegation({
      user: stean,
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

  it('mints for a served client org without a conversationId', async () => {
    mockStaffCanServe.mockResolvedValue(true)
    const { mintAgentDelegation } = await import('@/lib/api/delegations')
    const minted = await mintAgentDelegation({
      user: stean,
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      agentId: 'pip',
      purpose: 'skill:crm',
    })

    expect(minted.orgIds).toEqual(['wS5pgwa6c9WbPocf4w0w', 'pib-platform-owner'])
    expect(mockStaffCanServe).toHaveBeenCalledWith(expect.objectContaining({ uid: 'stean' }), 'wS5pgwa6c9WbPocf4w0w')
  })

  it('rejects a client org the staff member does not serve when there is no conversation', async () => {
    mockStaffCanServe.mockResolvedValue(false)
    const { mintAgentDelegation } = await import('@/lib/api/delegations')
    await expect(mintAgentDelegation({
      user: stean,
      orgId: 'foreign-org',
      agentId: 'pip',
      purpose: 'skill:crm',
    })).rejects.toMatchObject({ status: 403 })
  })

  it('rejects a dummy conversationId that does not exist', async () => {
    const { mintAgentDelegation } = await import('@/lib/api/delegations')
    await expect(mintAgentDelegation({
      user: stean,
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      agentId: 'pip',
      purpose: 'messages:fake',
      conversationId: 'not-a-real-thread',
    })).rejects.toMatchObject({ status: 403 })
  })

  it('rejects a conversation that belongs to a different org', async () => {
    conversationDocs['conv-1'] = {
      orgId: 'other-org',
      participantUids: ['stean'],
    }
    const { mintAgentDelegation } = await import('@/lib/api/delegations')
    await expect(mintAgentDelegation({
      user: stean,
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      agentId: 'pip',
      purpose: 'messages:conv-1',
      conversationId: 'conv-1',
    })).rejects.toMatchObject({ status: 403 })
  })

  it('rejects a conversation the staff member cannot access', async () => {
    conversationDocs['conv-1'] = {
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      participantUids: ['someone-else'],
    }
    const { mintAgentDelegation } = await import('@/lib/api/delegations')
    await expect(mintAgentDelegation({
      user: stean,
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      agentId: 'pip',
      purpose: 'messages:conv-1',
      conversationId: 'conv-1',
    })).rejects.toMatchObject({ status: 403 })
  })
})
