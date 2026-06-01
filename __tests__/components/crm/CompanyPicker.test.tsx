import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CompanyPicker } from '@/components/crm/CompanyPicker'

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

// Helper: mock a successful search response
function mockSearchResponse(companies: Array<{ id: string; name: string; domain?: string }>) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: companies }),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CompanyPicker', () => {
  const noop = () => {}

  it('renders an input element', () => {
    render(<CompanyPicker onChange={noop} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('accepts a contextual search label', () => {
    render(<CompanyPicker ariaLabel="Linked company for Jane Client" onChange={noop} />)
    expect(screen.getByRole('combobox', { name: 'Linked company for Jane Client' })).toBeInTheDocument()
  })

  it('shows currentCompanyName in the input when provided', () => {
    render(
      <CompanyPicker
        currentCompanyId="co-1"
        currentCompanyName="ACME Corp"
        onChange={noop}
      />,
    )
    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toBe('ACME Corp')
  })

  it('shows search results after debounce', async () => {
    mockSearchResponse([
      { id: 'co-1', name: 'ACME Corp', domain: 'acme.com' },
      { id: 'co-2', name: 'ACME Ltd', domain: 'acmeltd.com' },
    ])

    render(<CompanyPicker onChange={noop} />)
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'acme' } })
    jest.advanceTimersByTime(350)

    await waitFor(() => {
      expect(screen.getByText('ACME Corp')).toBeInTheDocument()
      expect(screen.getByText('ACME Ltd')).toBeInTheDocument()
    })
  })

  it('calls onChange when a result is selected', async () => {
    mockSearchResponse([{ id: 'co-5', name: 'Globex Inc' }])
    const handleChange = jest.fn()

    render(<CompanyPicker onChange={handleChange} />)
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'globex' } })
    jest.advanceTimersByTime(350)

    await waitFor(() => {
      expect(screen.getByText('Globex Inc')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Globex Inc'))
    expect(handleChange).toHaveBeenCalledWith({ companyId: 'co-5', companyName: 'Globex Inc' })
  })

  it('shows a "+ Create new company" option in dropdown', async () => {
    mockSearchResponse([])
    render(<CompanyPicker onChange={noop} />)
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'brand new' } })
    jest.advanceTimersByTime(350)

    await waitFor(() => {
      expect(screen.getByText(/Create new company/i)).toBeInTheDocument()
    })
  })

  it('shows a clear button when a value is selected', () => {
    render(
      <CompanyPicker
        currentCompanyId="co-1"
        currentCompanyName="ACME Corp"
        onChange={noop}
      />,
    )
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
  })

  it('calls onChange with nulls when cleared', () => {
    const handleChange = jest.fn()
    render(
      <CompanyPicker
        currentCompanyId="co-1"
        currentCompanyName="ACME Corp"
        onChange={handleChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(handleChange).toHaveBeenCalledWith({ companyId: null, companyName: null })
  })

  it('does not fetch when query is empty', () => {
    render(<CompanyPicker onChange={noop} />)
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: '' } })
    jest.advanceTimersByTime(350)

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
