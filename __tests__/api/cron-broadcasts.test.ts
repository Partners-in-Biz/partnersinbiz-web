import { NextRequest } from 'next/server'

const mockResolveBroadcastAudience = jest.fn()
const mockBuildSendContext = jest.fn()
const mockLoadSentContactIds = jest.fn()
const mockSendBroadcastToContact = jest.fn()
const mockSendBroadcastToContactWithVariant = jest.fn()
const mockMaybeFinalizeWinner = jest.fn()
const mockDispatchWinnerToRemaining = jest.fn()

jest.mock('@/lib/broadcasts/audience', () => ({
  resolveBroadcastAudience: mockResolveBroadcastAudience,
}))

jest.mock('@/lib/broadcasts/send', () => ({
  buildSendContext: mockBuildSendContext,
  loadSentContactIds: mockLoadSentContactIds,
  sendBroadcastToContact: mockSendBroadcastToContact,
  sendBroadcastToContactWithVariant: mockSendBroadcastToContactWithVariant,
}))

jest.mock('@/lib/ab-testing/cronHelpers', () => ({
  maybeFinalizeWinner: mockMaybeFinalizeWinner,
  dispatchWinnerToRemaining: mockDispatchWinnerToRemaining,
}))

const broadcastRecipientUpdate = jest.fn()

function emptyQuery() {
  return {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: [], empty: true }),
  }
}

const broadcastDoc = {
  id: 'broadcast-1',
  exists: true,
  data: () => ({
    orgId: 'org-1',
    channel: 'email',
    fromName: 'Base Name',
    fromLocal: 'news',
    ab: {
      enabled: true,
      mode: 'winner-only',
      status: 'winner-pending',
      winnerVariantId: 'winner',
      variants: [
        {
          id: 'winner',
          name: 'Winner',
          weight: 100,
          overrides: [{ kind: 'subject', subject: 'Winner subject' }],
        },
      ],
    },
  }),
}

const recipientDoc = {
  ref: {
    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ status: 'pending' }) }),
    update: broadcastRecipientUpdate,
  },
  data: () => ({
    broadcastId: 'broadcast-1',
    contactId: 'contact-1',
    variantId: 'winner',
    status: 'pending',
  }),
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'broadcast_recipients') {
        return {
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [recipientDoc], empty: false }),
        }
      }
      if (name === 'broadcasts') {
        return {
          where: jest.fn().mockReturnValue(emptyQuery()),
          doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue(broadcastDoc) })),
        }
      }
      if (name === 'contacts') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              id: 'contact-1',
              exists: true,
              data: () => ({ email: 'contact@example.com', orgId: 'org-1' }),
            }),
          })),
        }
      }
      if (name === 'emails') {
        return emptyQuery()
      }
      return emptyQuery()
    }),
  },
}))

describe('GET /api/cron/broadcasts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    mockResolveBroadcastAudience.mockResolvedValue([])
    mockBuildSendContext.mockResolvedValue({ broadcastId: 'broadcast-1' })
    mockLoadSentContactIds.mockResolvedValue(new Set())
    mockSendBroadcastToContact.mockResolvedValue({ status: 'sent' })
    mockSendBroadcastToContactWithVariant.mockResolvedValue({ status: 'sent', resendId: 'resend-1' })
    mockMaybeFinalizeWinner.mockResolvedValue(null)
    mockDispatchWinnerToRemaining.mockResolvedValue({ queued: 0 })
    recipientDoc.ref.get.mockResolvedValue({ exists: true, data: () => ({ status: 'pending' }) })
    broadcastRecipientUpdate.mockResolvedValue(undefined)
  })

  it('drains pending A/B winner-only broadcast recipients with the selected winner variant', async () => {
    const { GET } = await import('@/app/api/cron/broadcasts/route')
    const req = new NextRequest('http://localhost/api/cron/broadcasts', {
      headers: { authorization: 'Bearer cron-secret' },
    })

    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockSendBroadcastToContactWithVariant).toHaveBeenCalledWith(
      { broadcastId: 'broadcast-1' },
      expect.objectContaining({ id: 'contact-1', email: 'contact@example.com' }),
      expect.objectContaining({ id: 'winner' }),
      null,
    )
    expect(broadcastRecipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', resendId: 'resend-1' }),
    )
    expect(body.data.recipientsDrained).toBe(1)
    expect(body.data.recipientsFailed).toBe(0)
  })
})
