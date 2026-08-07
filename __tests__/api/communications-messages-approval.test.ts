import { NextRequest } from 'next/server'

/**
 * Approval-gate regression tests for the outbound messages route.
 * The server gate must reject sendNow without humanApproved, and approved
 * sends must dispatch through the provider send path.
 */

const addConversationMessageMock = jest.fn()
const getConversationBundleMock = jest.fn()
const sendApprovedConversationMessageMock = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: Record<string, unknown>, context: { params: Promise<{ id: string }> }) => Promise<Response>) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handler(req, { uid: 'member-1', role: 'client', authKind: 'session', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/api/orgScope', () => ({
  resolveOrgScope: (user: unknown, requestedOrgId: string | null) => {
    if (requestedOrgId === 'denied-org') return { ok: false, status: 403, error: 'Forbidden' }
    return { ok: true, orgId: requestedOrgId ?? 'org-1' }
  },
}))

jest.mock('@/lib/api/actor', () => ({
  actorFrom: () => ({ createdBy: 'member-1', createdByType: 'user' as const }),
}))

jest.mock('@/lib/communications/store', () => ({
  addConversationMessage: (...args: unknown[]) => addConversationMessageMock(...args),
  getConversationBundle: (...args: unknown[]) => getConversationBundleMock(...args),
}))

jest.mock('@/lib/communications/send', () => ({
  sendApprovedConversationMessage: (...args: unknown[]) => sendApprovedConversationMessageMock(...args),
}))

import { POST } from '@/app/api/v1/communications/conversations/[id]/messages/route'

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/v1/communications/conversations/conv-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'conv-1' }) },
  )
}

describe('POST /api/v1/communications/conversations/[id]/messages — approval gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    addConversationMessageMock.mockResolvedValue({ id: 'msg-1', status: 'queued' })
    sendApprovedConversationMessageMock.mockResolvedValue({ ok: true, status: 'sent', providerMessageId: 'SMxxxx' })
  })

  it('rejects sendNow=true without humanApproved (400) and never stores the message', async () => {
    const res = await post({ orgId: 'org-1', body: 'Hello', sendNow: true })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain('Human approval is required')
    expect(addConversationMessageMock).not.toHaveBeenCalled()
    expect(sendApprovedConversationMessageMock).not.toHaveBeenCalled()
  })

  it('stores and dispatches an approved send (sendNow + humanApproved)', async () => {
    const res = await post({ orgId: 'org-1', body: 'Hello', sendNow: true, humanApproved: true })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(addConversationMessageMock).toHaveBeenCalledWith(
      'org-1',
      'conv-1',
      expect.objectContaining({ body: 'Hello', direction: 'outbound', status: 'queued' }),
    )
    expect(sendApprovedConversationMessageMock).toHaveBeenCalledWith('org-1', 'msg-1')
    expect(body.data.send).toEqual({ ok: true, status: 'sent', providerMessageId: 'SMxxxx', error: null })
  })

  it('saves drafts without dispatching a send', async () => {
    const res = await post({ orgId: 'org-1', body: 'Draft text' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(addConversationMessageMock).toHaveBeenCalledWith(
      'org-1',
      'conv-1',
      expect.objectContaining({ status: 'draft' }),
    )
    expect(sendApprovedConversationMessageMock).not.toHaveBeenCalled()
    expect(body.data.send).toBeNull()
  })
})
