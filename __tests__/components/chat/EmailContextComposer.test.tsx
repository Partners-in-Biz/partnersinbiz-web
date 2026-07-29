import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EmailContextComposer } from '@/components/chat/context/EmailContextComposer'

const draftMessage = {
  id: 'draft-1',
  orgId: 'org-1',
  uid: 'user-1',
  profileId: 'org-1_user-1',
  accountId: 'acct-1',
  accountEmail: 'me@example.com',
  folder: 'drafts',
  direction: 'draft',
  status: 'draft',
  read: true,
  starred: false,
  from: 'me@example.com',
  to: ['lead@example.com'],
  cc: [],
  bcc: [],
  subject: 'Proposal follow-up',
  bodyText: 'Thanks for the call.',
  attachments: [],
  snippet: 'Thanks for the call.',
  createdAt: '2026-07-23T10:00:00.000Z',
  updatedAt: '2026-07-23T10:00:00.000Z',
}

const accounts = [{
  id: 'acct-1',
  orgId: 'org-1',
  uid: 'user-1',
  profileId: 'org-1_user-1',
  provider: 'google',
  emailAddress: 'me@example.com',
  displayName: 'Me',
  status: 'connected',
  isDefault: true,
  hasSmtp: false,
  hasImap: false,
  hasGoogleOAuth: true,
  lastSyncAt: null,
  createdAt: null,
  updatedAt: null,
}]

beforeEach(() => {
  window.confirm = jest.fn(() => true)
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/accounts')) {
      return {
        ok: true,
        json: async () => ({ data: { accounts } }),
      } as Response
    }
    if (url.endsWith('/messages/draft-1') && (!init?.method || init.method === 'GET')) {
      return {
        ok: true,
        json: async () => ({ data: { message: draftMessage } }),
      } as Response
    }
    if (url.endsWith('/messages/draft-1') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body ?? '{}'))
      return {
        ok: true,
        json: async () => ({
          data: {
            message: {
              ...draftMessage,
              ...body,
              to: typeof body.to === 'string' ? body.to.split(',').map((part: string) => part.trim()).filter(Boolean) : draftMessage.to,
              folder: body.folder ?? draftMessage.folder,
            },
          },
        }),
      } as Response
    }
    if (url.endsWith('/messages') && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          data: {
            message: {
              ...draftMessage,
              id: 'sent-1',
              folder: 'sent',
              direction: 'outbound',
              status: 'sent',
              subject: 'Proposal follow-up',
            },
          },
        }),
      } as Response
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`)
  }) as jest.Mock
})

afterEach(() => {
  jest.resetAllMocks()
})

it('loads the connected mailbox draft and approves a send through the human mailbox path', async () => {
  render(<EmailContextComposer messageId="draft-1" />)

  expect(await screen.findByTestId('context-email-composer')).toBeInTheDocument()
  expect(screen.getByLabelText('Sending account')).toHaveDisplayValue('me@example.com (default)')
  expect(screen.getByLabelText('To')).toHaveValue('lead@example.com')
  expect(screen.getByLabelText('Subject')).toHaveValue('Proposal follow-up')
  expect(screen.getByLabelText('Body')).toHaveValue('Thanks for the call.')

  fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Updated body' } })
  fireEvent.click(screen.getByRole('button', { name: 'Approve & send' }))

  await waitFor(() => {
    expect(screen.getByText('Sent')).toBeInTheDocument()
  })

  const calls = (global.fetch as jest.Mock).mock.calls.map(([url, init]) => ({ url: String(url), method: init?.method ?? 'GET', body: init?.body }))
  expect(calls.some((call) => call.url.endsWith('/messages/draft-1') && call.method === 'PATCH' && String(call.body).includes('Updated body'))).toBe(true)
  expect(calls.some((call) => call.url.endsWith('/messages') && call.method === 'POST' && String(call.body).includes('"sendApproved":true'))).toBe(true)
})

it('shows a reconnect Google CTA when the only mailbox needs connection', async () => {
  const disconnected = [{
    ...accounts[0],
    status: 'needs_setup',
    hasGoogleOAuth: false,
  }]
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/accounts')) {
      return { ok: true, json: async () => ({ data: { accounts: disconnected } }) } as Response
    }
    if (url.endsWith('/messages/draft-1') && (!init?.method || init.method === 'GET')) {
      return { ok: true, json: async () => ({ data: { message: draftMessage } }) } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as jest.Mock

  render(<EmailContextComposer messageId="draft-1" />)

  expect(await screen.findByTestId('mailbox-reconnect-banner')).toBeInTheDocument()
  expect(screen.getByText(/needs Google reconnection before you can send/i)).toBeInTheDocument()
  const reconnect = screen.getByRole('link', { name: 'Reconnect Google' })
  expect(reconnect).toHaveAttribute('href', expect.stringContaining('/api/v1/portal/email/google/authorize'))
  expect(reconnect).toHaveAttribute('href', expect.stringContaining('emailAddress=me%40example.com'))
  expect(screen.getByLabelText('Sending account')).toHaveDisplayValue('me@example.com (reconnect required)')
  expect(screen.queryByRole('button', { name: 'Approve & send' })).toBeDisabled()
})
