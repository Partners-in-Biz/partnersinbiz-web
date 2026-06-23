const mockReadEmailControls = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/app/api/v1/admin/email/controls/store', () => ({
  readEmailControls: (...args: unknown[]) => mockReadEmailControls(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollection(...args),
  },
}))

function makeRule(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReadEmailControls.mockResolvedValue({
    pauseOutbound: false,
    pauseReason: null,
  })
  mockCollection.mockImplementation((collectionName: string) => {
    if (collectionName !== 'admin_email_domain_rules') {
      throw new Error(`Unexpected collection ${collectionName}`)
    }
    return {
      get: async () => ({
        docs: [],
      }),
    }
  })
})

describe('email policy enforcement', () => {
  it('blocks outbound sends while platform email is paused', async () => {
    mockReadEmailControls.mockResolvedValueOnce({
      pauseOutbound: true,
      pauseReason: 'Incident response',
    })

    const { assertOutboundEmailAllowed } = await import('@/lib/email/policy')

    await expect(assertOutboundEmailAllowed({ recipients: ['client@example.com'] })).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        status: 409,
      }),
    )
  })

  it('blocks sending-domain registration when a block rule matches the domain', async () => {
    mockCollection.mockImplementationOnce(() => ({
      get: async () => ({
        docs: [
          makeRule('block__blocked.example', {
            domain: 'blocked.example',
            type: 'block',
            reason: 'Disallowed sender domain',
            autoApprove: false,
          }),
        ],
      }),
    }))

    const { assertEmailDomainRegistrationAllowed } = await import('@/lib/email/policy')

    await expect(assertEmailDomainRegistrationAllowed('blocked.example')).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        status: 403,
      }),
    )
  })
})
