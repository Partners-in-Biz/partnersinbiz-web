import { FieldValue, Timestamp } from 'firebase-admin/firestore'

const mockSet = jest.fn()
const mockCommit = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollection(...args),
    batch: () => ({ set: mockSet, update: jest.fn(), commit: mockCommit }),
  },
}))

import { createSupportTicket, listPortalSupportTickets } from '@/lib/support/store'

function isServerTimestamp(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const row = value as { isEqual?: (other: unknown) => boolean; _methodName?: string }
  if (typeof row.isEqual === 'function') {
    try {
      return row.isEqual(FieldValue.serverTimestamp())
    } catch {
      return false
    }
  }
  return row._methodName === 'serverTimestamp' || row._methodName === 'FieldValue.serverTimestamp'
}

function hasServerTimestampInArray(value: unknown, inArray = false): boolean {
  if (Array.isArray(value)) return value.some((item) => hasServerTimestampInArray(item, true))
  if (inArray && isServerTimestamp(value)) return true
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => hasServerTimestampInArray(item, inArray))
  }
  return false
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCommit.mockResolvedValue(undefined)
  let docSeq = 0
  mockCollection.mockImplementation((name: string) => ({
    doc: (id?: string) => ({ id: id ?? `${name}-${++docSeq}` }),
    where: (...args: unknown[]) => mockWhere(...args),
  }))
  mockWhere.mockReturnValue({ get: mockGet })
})

describe('createSupportTicket', () => {
  it('does not put FieldValue.serverTimestamp inside the participants array', async () => {
    const id = await createSupportTicket({
      orgId: 'org-1',
      uid: 'user-1',
      requesterName: 'Client',
      requesterEmail: 'client@example.com',
      category: 'urgent',
      priority: 'urgent',
      subject: 'Invoice generation - Elemental',
      description: 'I cant issue an invoice - i don\'t have rights.',
    })

    expect(id).toBeTruthy()
    expect(mockCommit).toHaveBeenCalledTimes(1)
    const ticket = mockSet.mock.calls[0][1] as Record<string, unknown>
    expect(hasServerTimestampInArray(ticket)).toBe(false)
    expect(ticket.participants).toEqual([
      expect.objectContaining({
        id: 'requester:user-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: 'requester',
        status: 'active',
        acceptedAt: expect.any(Timestamp),
      }),
    ])
    expect(isServerTimestamp(ticket.createdAt)).toBe(true)
    expect(isServerTimestamp(ticket.lastMessageAt)).toBe(true)
  })
})

describe('listPortalSupportTickets', () => {
  it('lists by org and filters to the requester in memory', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'mine', data: () => ({ orgId: 'org-1', createdBy: 'user-1', subject: 'Mine', deleted: false }) },
        { id: 'theirs', data: () => ({ orgId: 'org-1', createdBy: 'user-2', subject: 'Theirs', deleted: false }) },
        { id: 'gone', data: () => ({ orgId: 'org-1', createdBy: 'user-1', subject: 'Gone', deleted: true }) },
      ],
    })

    const tickets = await listPortalSupportTickets('org-1', 'user-1')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(tickets.map((ticket) => ticket.id)).toEqual(['mine'])
  })
})
