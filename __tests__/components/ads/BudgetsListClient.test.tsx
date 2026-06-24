/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { BudgetsListClient, type BudgetRow } from '@/components/ads/BudgetsListClient'

// Mock next/link to render as <a>
jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
  Link.displayName = 'Link'
  return Link
})

const MOCK_BUDGETS: BudgetRow[] = [
  {
    id: 'bgt_1',
    name: 'Org Monthly Cap',
    scope: 'org',
    period: 'monthly',
    capCents: 100000,
    currencyCode: 'USD',
    currentSpendPercent: 45,
    currentSpendCents: 45000,
  },
  {
    id: 'bgt_2',
    name: 'Meta Daily Budget',
    scope: 'platform',
    platform: 'meta',
    period: 'daily',
    capCents: 5000,
    currencyCode: 'USD',
    currentSpendPercent: 80,
    currentSpendCents: 4000,
  },
  {
    id: 'bgt_3',
    name: 'Campaign Spend Cap',
    scope: 'campaign',
    platform: 'google',
    campaignId: 'cmp_abc',
    period: 'weekly',
    capCents: 20000,
    currencyCode: 'USD',
    currentSpendPercent: 95,
    currentSpendCents: 19000,
  },
  {
    id: 'bgt_4',
    name: 'Old Archived Budget',
    scope: 'org',
    period: 'monthly',
    capCents: 50000,
    currencyCode: 'USD',
    currentSpendPercent: 100,
    currentSpendCents: 50000,
    archivedAt: true,
  },
]

describe('BudgetsListClient', () => {
  it('renders list rows with BudgetPaceMeter', () => {
    render(<BudgetsListClient budgets={MOCK_BUDGETS} orgSlug="acme" />)

    // Active budgets (not archived) should be shown in "All" tab
    expect(screen.getByText('Org Monthly Cap')).toBeInTheDocument()
    expect(screen.getByText('Meta Daily Budget')).toBeInTheDocument()
    expect(screen.getByText('Campaign Spend Cap')).toBeInTheDocument()
    // Archived should NOT show in "All" tab
    expect(screen.queryByText('Old Archived Budget')).not.toBeInTheDocument()

    // BudgetPaceMeter renders percentages
    expect(screen.getByText('45.0%')).toBeInTheDocument()
    expect(screen.getByText('80.0%')).toBeInTheDocument()
    expect(screen.getByText('95.0%')).toBeInTheDocument()
  })

  it('filter tabs filter visible rows', () => {
    render(<BudgetsListClient budgets={MOCK_BUDGETS} orgSlug="acme" />)

    // Click "Org" tab
    fireEvent.click(screen.getByRole('tab', { name: 'Org' }))
    expect(screen.getByText('Org Monthly Cap')).toBeInTheDocument()
    expect(screen.queryByText('Meta Daily Budget')).not.toBeInTheDocument()
    expect(screen.queryByText('Campaign Spend Cap')).not.toBeInTheDocument()

    // Click "Per-Platform" tab
    fireEvent.click(screen.getByRole('tab', { name: 'Per-Platform' }))
    expect(screen.queryByText('Org Monthly Cap')).not.toBeInTheDocument()
    expect(screen.getByText('Meta Daily Budget')).toBeInTheDocument()
    expect(screen.queryByText('Campaign Spend Cap')).not.toBeInTheDocument()

    // Click "Per-Campaign" tab
    fireEvent.click(screen.getByRole('tab', { name: 'Per-Campaign' }))
    expect(screen.queryByText('Org Monthly Cap')).not.toBeInTheDocument()
    expect(screen.queryByText('Meta Daily Budget')).not.toBeInTheDocument()
    expect(screen.getByText('Campaign Spend Cap')).toBeInTheDocument()

    // Click "Archived" tab
    fireEvent.click(screen.getByRole('tab', { name: 'Archived' }))
    expect(screen.queryByText('Org Monthly Cap')).not.toBeInTheDocument()
    expect(screen.getByText('Old Archived Budget')).toBeInTheDocument()
  })

  it('+ New budget link goes to /new', () => {
    render(<BudgetsListClient budgets={MOCK_BUDGETS} orgSlug="acme" />)
    const newLink = screen.getByRole('link', { name: /New budget/i })
    expect(newLink).toHaveAttribute('href', '/admin/org/acme/ads/budgets/new')
  })

  it('archives a budget through an in-page confirmation without native dialogs', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock

    render(<BudgetsListClient budgets={MOCK_BUDGETS} orgSlug="acme" />)

    fireEvent.click(screen.getByRole('button', { name: 'Archive budget Org Monthly Cap for acme' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Archive budget Org Monthly Cap for acme?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes Org Monthly Cap from active admin budget pacing. Historical spend and alerts stay in PiB; it does not approve or increase paid spend.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm archive budget Org Monthly Cap for acme' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/ads/budgets/bgt_1', { method: 'DELETE' })
    })

    expect(screen.getByText('Budget Org Monthly Cap archived.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Budget Org Monthly Cap')).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})
