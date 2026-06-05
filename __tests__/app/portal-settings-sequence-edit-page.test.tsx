import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EditSequencePage from '@/app/(portal)/portal/settings/sequences/[id]/edit/page'

const push = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/crm/SequenceForm', () => ({
  SequenceForm: () => <div>Sequence form rendered</div>,
}))

describe('Portal settings sequence edit page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
  })

  it('warns when the sequence editor source fails and gives leaders a retry path', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/sequences/seq-edit') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Sequence editor source unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    await act(async () => {
      render(<EditSequencePage params={Promise.resolve({ id: 'seq-edit' })} />)
    })

    expect(await screen.findByRole('heading', { name: 'Sequence journey could not load' })).toBeInTheDocument()
    expect(screen.getByText('Sequence editor source unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Sequence form rendered')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading sequence journey' }))

    await waitFor(() => {
      const sequenceRequests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => (
        String(url) === '/api/v1/crm/sequences/seq-edit'
      ))
      expect(sequenceRequests).toHaveLength(2)
    })
  })

  it('loads sequence edits through the active company workspace scope', async () => {
    mockSearchParams = new URLSearchParams({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/sequences/seq-edit?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              sequence: {
                id: 'seq-edit',
                orgId: 'lumen-org',
                name: 'Lumen lead welcome',
                description: '',
                status: 'draft',
                steps: [{ delayDays: 0, channel: 'email', subject: 'Welcome', bodyText: '' }],
                createdAt: null,
                updatedAt: null,
              },
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    await act(async () => {
      render(<EditSequencePage params={Promise.resolve({ id: 'seq-edit' })} />)
    })

    expect(await screen.findByText('Sequence form rendered')).toBeInTheDocument()
  })
})
