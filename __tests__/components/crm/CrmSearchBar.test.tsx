import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CrmSearchBar } from '@/components/crm/CrmSearchBar'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, onClick, ...props }: { children: React.ReactNode; href: string; onClick?: () => void }) => (
    <a href={href} onClick={onClick} {...props}>{children}</a>
  ),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

describe('CrmSearchBar', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockFetch.mockReset()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('names sparse contact search results instead of showing a bare placeholder', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const path = String(url)
      if (path.startsWith('/api/v1/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [{ id: 'contact-1', name: '', email: '' }] }),
        } as Response)
      }
      if (path.startsWith('/api/v1/crm/companies') || path.startsWith('/api/v1/crm/deals')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [] }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmSearchBar />)

    fireEvent.change(screen.getByLabelText('Search contacts, companies, and deals'), {
      target: { value: 'missing' },
    })

    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    await waitFor(() => expect(screen.getByText('Contact identity missing')).toBeInTheDocument())
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Contact identity missing/i })).toHaveAttribute('href', '/portal/contacts/contact-1')
  })
})
