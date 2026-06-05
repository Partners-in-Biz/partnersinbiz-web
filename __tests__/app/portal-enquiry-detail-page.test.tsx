import { render, screen, waitFor } from '@testing-library/react'

import EnquiryDetailPage from '@/app/(portal)/portal/enquiries/[id]/page'

const mockPush = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: { uid: string; email: string }) => void) => {
    cb({ uid: 'user-1', email: 'peet@example.com' })
    return jest.fn()
  },
}))

jest.mock('@/lib/firebase/config', () => ({
  auth: {},
}))

jest.mock('@/components/portal/MessageThread', () => ({
  __esModule: true,
  default: ({ enquiryId, messages }: { enquiryId: string; messages: unknown[] }) => (
    <div data-testid="message-thread" data-enquiry-id={enquiryId}>
      {messages.length} messages
    </div>
  ),
}))

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response
}

describe('Portal enquiry detail page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/enquiries/enq-1') {
        return jsonResponse({
          data: {
            id: 'enq-1',
            projectType: 'growth_marketing',
            status: 'reviewing',
            details: 'We need a sharper CRM launch plan and weekly reporting.',
            company: 'Lumen',
          },
        })
      }
      if (url === '/api/v1/portal/messages?enquiryId=enq-1') {
        return jsonResponse({ data: [{ id: 'msg-1', text: 'Can we meet?', direction: 'outbound', authorName: 'Pip' }] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
  })

  it('keeps source workspace context visible and scoped on project handoffs', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })

    render(<EnquiryDetailPage params={Promise.resolve({ id: 'enq-1' })} />)

    expect(await screen.findByRole('heading', { name: 'Project intake command center' })).toBeInTheDocument()
    expect(screen.getByText('Lumen workspace')).toBeInTheDocument()
    expect(screen.getByText('Intake status')).toBeInTheDocument()
    expect(screen.getByText('Team next step')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to projects/i })).toHaveAttribute(
      'href',
      '/portal/projects?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.getByTestId('message-thread')).toHaveAttribute('data-enquiry-id', 'enq-1')

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/enquiries/enq-1')
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/messages?enquiryId=enq-1')
    })
  })
})
