/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { BudgetDetailClient } from '@/components/ads/BudgetDetailClient'

jest.mock('@/components/ads/BudgetCapEditor', () => ({
  BudgetCapEditor: () => <div>Edit budget form</div>,
}))

const BUDGET = {
  id: 'bgt_1',
  orgId: 'org_1',
  name: 'Org Monthly Cap',
  scope: 'org' as const,
  capCents: 100000,
  currencyCode: 'USD',
  period: 'monthly',
  currentSpendCents: 45000,
  currentSpendPercent: 45,
  autoPause: true,
  alertThresholds: [50, 80, 100],
}

describe('BudgetDetailClient', () => {
  it('resets a budget period through an in-page confirmation without native dialogs', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { currentSpendCents: 0, currentSpendPercent: 0 } }),
    })
    global.fetch = fetchMock

    render(<BudgetDetailClient budget={BUDGET} events={[]} orgSlug="acme" />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset period for budget Org Monthly Cap' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Reset budget period for Org Monthly Cap?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Spend tracking restarts at 0 for the current monthly period. Historical budget events stay in PiB.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm reset period for budget Org Monthly Cap' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/ads/budgets/bgt_1/reset', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })

    expect(await screen.findByText('Budget period reset. Spend tracking is back at 0.')).toBeInTheDocument()
    expect(screen.getByText('0.0%')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('archives a budget through an in-page confirmation without leaving the detail screen', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock

    render(<BudgetDetailClient budget={BUDGET} events={[]} orgSlug="acme" />)

    fireEvent.click(screen.getByRole('button', { name: 'Archive budget Org Monthly Cap for acme' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Archive budget Org Monthly Cap for acme?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This removes Org Monthly Cap from active pacing controls. Historical spend and events stay in PiB.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive budget Org Monthly Cap for acme' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/ads/budgets/bgt_1', {
        method: 'DELETE',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })

    expect(screen.getByText('Budget Org Monthly Cap archived.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive budget Org Monthly Cap for acme' })).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})
