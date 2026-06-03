import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EditSequencePage from '@/app/(portal)/portal/settings/sequences/[id]/edit/page'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

jest.mock('@/components/crm/SequenceForm', () => ({
  SequenceForm: () => <div>Sequence form rendered</div>,
}))

describe('Portal settings sequence edit page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
})
