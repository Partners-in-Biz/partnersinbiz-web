import { notifyClientDocumentAccepted, notifyQuoteAccepted } from '@/lib/notifications/client-acceptance'

const mockUsersGet = jest.fn()
const notificationWrites = new Map<string, unknown>()
const emailQueueWrites = new Map<string, unknown>()
const setCalls: Array<{ id: string; payload: unknown }> = []
const createCalls: Array<{ id: string; payload: unknown }> = []

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'users') {
        return {
          where: jest.fn(() => ({ get: mockUsersGet })),
        }
      }
      if (name === 'notifications') {
        return {
          doc: jest.fn((id: string) => ({
            set: jest.fn(async (payload: unknown) => {
              notificationWrites.set(id, payload)
              setCalls.push({ id, payload })
            }),
          })),
        }
      }
      if (name === 'emails') {
        return {
          doc: jest.fn((id: string) => ({
            create: jest.fn(async (payload: unknown) => {
              if (emailQueueWrites.has(id)) {
                const err = new Error('Already exists') as Error & { code?: number }
                err.code = 6
                throw err
              }
              emailQueueWrites.set(id, payload)
              createCalls.push({ id, payload })
            }),
          })),
        }
      }
      if (name === 'admin_notification_preferences') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({ exists: false, data: () => undefined })),
          })),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    }),
  },
}))

type UserDoc = { id: string; data: () => Record<string, unknown> }

function userDoc(id: string, data: Record<string, unknown>): UserDoc {
  return { id, data: () => data }
}

function stageAdmins() {
  mockUsersGet.mockResolvedValue({
    docs: [
      userDoc('super-admin', { role: 'admin', email: 'super@test.com', displayName: 'Super Admin' }),
      userDoc('restricted-admin', {
        role: 'admin',
        email: 'restricted@test.com',
        allowedOrgIds: ['org-1'],
        notificationPreferences: { clientAcceptance: { platform: true, email: true } },
      }),
      userDoc('other-client-admin', { role: 'admin', email: 'other@test.com', allowedOrgIds: ['org-2'] }),
      userDoc('unsubscribed-admin', {
        role: 'admin',
        email: 'unsubscribed@test.com',
        allowedOrgIds: ['org-1'],
        notificationPreferences: { clientAcceptance: { platform: false, email: false } },
      }),
      userDoc('email-muted-admin', {
        role: 'admin',
        email: 'muted@test.com',
        allowedOrgIds: ['org-1'],
        notificationPreferences: { clientAcceptance: { platform: true, email: false } },
      }),
    ],
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  notificationWrites.clear()
  emailQueueWrites.clear()
  setCalls.length = 0
  createCalls.length = 0
  stageAdmins()
})

describe('client acceptance platform notifications', () => {
  it('writes unread platform notifications for subscribed admins who can access the client org', async () => {
    await notifyClientDocumentAccepted({
      orgId: 'org-1',
      documentId: 'doc-1',
      documentTitle: 'Growth Proposal',
      versionId: 'version-1',
      approvalId: 'approval-1',
      actorName: 'Client Owner',
      mode: 'formal_acceptance',
    })

    expect(notificationWrites.size).toBe(3)
    const payloads = Array.from(notificationWrites.values()) as Array<Record<string, unknown>>
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orgId: 'org-1',
          userId: 'super-admin',
          agentId: null,
          type: 'client_document.accepted',
          title: 'Proposal accepted',
          status: 'unread',
          priority: 'high',
          link: '/admin/documents/doc-1',
        }),
        expect.objectContaining({ userId: 'restricted-admin' }),
      ]),
    )
    expect(payloads).not.toEqual(expect.arrayContaining([expect.objectContaining({ userId: 'other-client-admin' })]))
    expect(payloads).not.toEqual(expect.arrayContaining([expect.objectContaining({ userId: 'unsubscribed-admin' })]))
  })

  it('uses deterministic notification ids so retried document acceptance does not create duplicates', async () => {
    const event = {
      orgId: 'org-1',
      documentId: 'doc-1',
      documentTitle: 'Growth Proposal',
      versionId: 'version-1',
      approvalId: 'approval-1',
      actorName: 'Client Owner',
      mode: 'formal_acceptance' as const,
    }

    await notifyClientDocumentAccepted(event)
    await notifyClientDocumentAccepted(event)

    expect(notificationWrites.size).toBe(3)
    expect(new Set(setCalls.map((call) => call.id)).size).toBe(3)
  })

  it('queues acceptance emails for subscribed admins with email enabled only once per retried event', async () => {
    const event = {
      orgId: 'org-1',
      documentId: 'doc-1',
      documentTitle: 'Growth Proposal',
      versionId: 'version-1',
      approvalId: 'approval-1',
      actorName: 'Client Owner',
      mode: 'formal_acceptance' as const,
    }

    await notifyClientDocumentAccepted(event)
    await notifyClientDocumentAccepted(event)

    expect(emailQueueWrites.size).toBe(2)
    expect(new Set(createCalls.map((call) => call.id)).size).toBe(2)
    const payloads = Array.from(emailQueueWrites.values()) as Array<Record<string, unknown>>
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orgId: 'org-1',
          to: 'super@test.com',
          status: 'scheduled',
          subject: 'Growth Proposal — Accepted ✓',
          metadata: expect.objectContaining({
            eventName: 'client_document.accepted',
            documentId: 'doc-1',
            approvalId: 'approval-1',
          }),
        }),
        expect.objectContaining({ to: 'restricted@test.com' }),
      ]),
    )
    expect(payloads).not.toEqual(expect.arrayContaining([expect.objectContaining({ to: 'muted@test.com' })]))
    expect(payloads).not.toEqual(expect.arrayContaining([expect.objectContaining({ to: 'other@test.com' })]))
  })

  it('also supports existing quote acceptance events across platform and email without duplicate queued emails', async () => {
    const event = {
      orgId: 'org-1',
      quoteId: 'quote-1',
      quoteNumber: 'Q-001',
      total: 15000,
      currency: 'ZAR',
      companyName: 'Client Co',
    }

    await notifyQuoteAccepted(event)
    await notifyQuoteAccepted(event)

    expect(notificationWrites.size).toBe(3)
    expect(Array.from(notificationWrites.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'quote.accepted',
          title: 'Quote accepted',
          body: expect.stringContaining('Q-001'),
          link: '/admin/quotes/quote-1',
          status: 'unread',
        }),
      ]),
    )
    expect(emailQueueWrites.size).toBe(2)
    expect(Array.from(emailQueueWrites.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'super@test.com',
          subject: 'Q-001 — Accepted ✓',
          metadata: expect.objectContaining({ eventName: 'quote.accepted', quoteId: 'quote-1' }),
        }),
        expect.objectContaining({ to: 'restricted@test.com' }),
      ]),
    )
  })
})
