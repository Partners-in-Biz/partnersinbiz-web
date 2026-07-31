const mockMessageGet = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async () => ({
      ok: true,
      model: {
        context: {
          kind: 'email',
          id: 'email-1',
          orgId: 'org-1',
          label: 'Launch',
          icon: 'mail',
          href: '/admin/email/mailbox?folder=inbox&messageId=email-1',
        },
        pulse: { label: 'email', metrics: [] },
        groups: [],
        artifacts: [],
        attention: [],
        activity: [],
        capabilities: ['open'],
        asOf: '2026-07-31T08:00:00.000Z',
      },
    })),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: mockMessageGet }),
    }),
  },
}))

describe('email chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMessageGet.mockResolvedValue({
      exists: true,
      id: 'email-1',
      data: () => ({
        orgId: 'org-1',
        uid: 'admin-1',
        profileId: 'org-1_admin-1',
        accountId: 'account-1',
        accountEmail: 'hello@example.test',
        folder: 'inbox',
        direction: 'inbound',
        status: 'received',
        read: false,
        starred: false,
        from: 'client@example.test',
        fromName: 'Jane Client',
        to: ['hello@example.test'],
        cc: [],
        bcc: [],
        subject: 'Launch approval',
        bodyText: 'Please confirm the launch.',
        snippet: 'Please confirm the launch.',
        attachments: [{ name: 'brief.pdf', contentType: 'application/pdf', sizeBytes: 1200 }],
        receivedAt: '2026-07-31T07:30:00.000Z',
        createdAt: '2026-07-31T07:30:00.000Z',
        updatedAt: '2026-07-31T08:00:00.000Z',
      }),
    })
  })

  it('projects live message metadata, preview, attention, activity, and safe actions', async () => {
    const { emailChatContextAdapter } = await import('@/lib/chat-context/adapters/email')
    const result = await emailChatContextAdapter.resolve({
      kind: 'email',
      id: 'email-1',
      user: { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toEqual(expect.objectContaining({
      label: 'Launch approval',
      href: '/admin/email/mailbox?folder=inbox&messageId=email-1',
    }))
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'status', label: 'Status', value: 'Received' },
      { id: 'folder', label: 'Folder', value: 'Inbox' },
      { id: 'read', label: 'Read', value: 'No' },
      { id: 'attachments', label: 'Attachments', value: 1 },
    ]))
    expect(result.model.attention[0]).toEqual(expect.objectContaining({
      id: 'email-unread',
      actions: expect.arrayContaining([expect.objectContaining({ id: 'mark-read-email:email-1' })]),
    }))
    expect(result.model.preview).toEqual(expect.objectContaining({
      kind: 'email',
      text: 'Please confirm the launch.',
    }))
    expect(result.model.activity.map((item) => item.id)).toEqual(['email-updated', 'email-received'])
    expect(result.model.capabilities).toContain('inline-actions')
  })

  it('fails closed when the message belongs to another same-organisation mailbox owner', async () => {
    const { emailChatContextAdapter } = await import('@/lib/chat-context/adapters/email')
    const result = await emailChatContextAdapter.resolve({
      kind: 'email',
      id: 'email-1',
      user: { uid: 'admin-2', role: 'admin', authKind: 'session', orgId: 'org-1' },
    })

    expect(result).toMatchObject({ ok: false, reason: 'not_found', status: 404 })
  })
})
