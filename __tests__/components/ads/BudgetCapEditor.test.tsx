/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { BudgetCapEditor } from '@/components/ads/BudgetCapEditor'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { id: 'bgt_test123' } }),
  }) as unknown as typeof fetch
})

describe('BudgetCapEditor', () => {
  it('renders all fields with defaults', () => {
    render(<BudgetCapEditor orgId="org_1" />)
    expect(screen.getByLabelText(/Budget name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Budget description/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Budget cap/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Currency/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Alert thresholds/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Auto-pause/i)).toBeInTheDocument()
    // Scope radios shown in create mode
    expect(screen.getByDisplayValue('org')).toBeInTheDocument()
    expect(screen.getByDisplayValue('platform')).toBeInTheDocument()
    expect(screen.getByDisplayValue('campaign')).toBeInTheDocument()
  })

  it('Platform field only shows when scope is not org', () => {
    render(<BudgetCapEditor orgId="org_1" />)
    // Default scope is org — the platform SELECT should not be visible
    // (the "Platform" radio label is part of the scope picker, use the select's aria-label)
    expect(screen.queryByRole('combobox', { name: /Platform/i })).not.toBeInTheDocument()

    // Switch to platform scope
    fireEvent.click(screen.getByDisplayValue('platform'))
    expect(screen.getByRole('combobox', { name: /Platform/i })).toBeInTheDocument()
  })

  it('CampaignId field only shows when scope is campaign', () => {
    render(<BudgetCapEditor orgId="org_1" />)
    expect(screen.queryByLabelText(/Campaign ID/i)).not.toBeInTheDocument()

    // Switch to platform scope — still no campaign ID, but platform select appears
    fireEvent.click(screen.getByDisplayValue('platform'))
    expect(screen.queryByLabelText(/Campaign ID/i)).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Platform/i })).toBeInTheDocument()

    // Switch to campaign scope
    fireEvent.click(screen.getByDisplayValue('campaign'))
    expect(screen.getByLabelText(/Campaign ID/i)).toBeInTheDocument()
    // Platform select also visible at campaign scope
    expect(screen.getByRole('combobox', { name: /Platform/i })).toBeInTheDocument()
  })

  it('capMajor input converts to capCents on submit (5.50 → 550)', async () => {
    render(<BudgetCapEditor orgId="org_1" />)

    fireEvent.change(screen.getByLabelText(/Budget name/i), { target: { value: 'Test budget' } })
    fireEvent.change(screen.getByLabelText(/Budget cap/i), { target: { value: '5.50' } })

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /Budget form/i }))
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/ads/budgets',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"capCents":550'),
        }),
      )
    })
  })

  it('alertThresholds input parses comma-separated → [75, 90, 100]', async () => {
    render(<BudgetCapEditor orgId="org_1" />)

    fireEvent.change(screen.getByLabelText(/Budget name/i), { target: { value: 'Test budget' } })
    fireEvent.change(screen.getByLabelText(/Budget cap/i), { target: { value: '100' } })
    // Default is already "75, 90, 100"
    fireEvent.change(screen.getByLabelText(/Alert thresholds/i), {
      target: { value: '75, 90, 100' },
    })

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /Budget form/i }))
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/ads/budgets',
        expect.objectContaining({
          body: expect.stringContaining('"alertThresholds":[75,90,100]'),
        }),
      )
    })
  })

  it('POSTs to /api/v1/ads/budgets in create mode; PATCHes when budgetId provided', async () => {
    // Create mode
    const { unmount } = render(<BudgetCapEditor orgId="org_1" />)
    fireEvent.change(screen.getByLabelText(/Budget name/i), { target: { value: 'My budget' } })
    fireEvent.change(screen.getByLabelText(/Budget cap/i), { target: { value: '200' } })

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /Budget form/i }))
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/ads/budgets',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    unmount()
    ;(global.fetch as jest.Mock).mockClear()

    // Edit mode
    render(<BudgetCapEditor orgId="org_1" budgetId="bgt_abc" initial={{ name: 'Old', capMajor: 100 }} />)
    fireEvent.change(screen.getByLabelText(/Budget name/i), { target: { value: 'Updated budget' } })

    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: /Budget form/i }))
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/ads/budgets/bgt_abc',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })
})
