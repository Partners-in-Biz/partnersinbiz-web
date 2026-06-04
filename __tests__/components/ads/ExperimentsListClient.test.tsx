/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import {
  ExperimentsListClient,
  type ExperimentRow,
} from '@/components/ads/ExperimentsListClient'

// Mock next/link
jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
  Link.displayName = 'Link'
  return Link
})

const MOCK_EXPERIMENTS: ExperimentRow[] = [
  {
    id: 'exp_1',
    name: 'CTA Button Test',
    status: 'draft',
    platform: 'meta',
    level: 'adset',
    variantCount: 2,
    startedAt: null,
  },
  {
    id: 'exp_2',
    name: 'Headline Variation',
    status: 'running',
    platform: 'google',
    level: 'ad',
    variantCount: 3,
    startedAt: { seconds: Math.floor(Date.now() / 1000) - 3 * 86400 },
    significance: { pValue: 0.03, confident: true },
  },
  {
    id: 'exp_3',
    name: 'Old Completed Test',
    status: 'completed',
    platform: 'linkedin',
    level: 'adset',
    variantCount: 2,
    startedAt: { seconds: Math.floor(Date.now() / 1000) - 14 * 86400 },
    archivedAt: undefined,
  },
]

describe('ExperimentsListClient', () => {
  it('renders rows with significance badge', () => {
    render(<ExperimentsListClient experiments={MOCK_EXPERIMENTS} orgSlug="acme" />)

    expect(screen.getByText('CTA Button Test')).toBeInTheDocument()
    expect(screen.getByText('Headline Variation')).toBeInTheDocument()
    expect(screen.getByText('Old Completed Test')).toBeInTheDocument()

    // Significance badge for exp_2
    expect(screen.getByText(/Significant \(p<0\.05\)/i)).toBeInTheDocument()
    // Awaiting data for experiments without significance (exp_1 and exp_3)
    const awaitingBadges = screen.getAllByText('Awaiting data')
    expect(awaitingBadges.length).toBeGreaterThanOrEqual(1)
  })

  it('filter tabs filter visible rows', () => {
    render(<ExperimentsListClient experiments={MOCK_EXPERIMENTS} orgSlug="acme" />)

    // Click "Draft" tab
    fireEvent.click(screen.getByRole('tab', { name: 'Draft' }))
    expect(screen.getByText('CTA Button Test')).toBeInTheDocument()
    expect(screen.queryByText('Headline Variation')).not.toBeInTheDocument()
    expect(screen.queryByText('Old Completed Test')).not.toBeInTheDocument()

    // Click "Running" tab
    fireEvent.click(screen.getByRole('tab', { name: 'Running' }))
    expect(screen.queryByText('CTA Button Test')).not.toBeInTheDocument()
    expect(screen.getByText('Headline Variation')).toBeInTheDocument()

    // Click "Completed" tab
    fireEvent.click(screen.getByRole('tab', { name: 'Completed' }))
    expect(screen.getByText('Old Completed Test')).toBeInTheDocument()
    expect(screen.queryByText('CTA Button Test')).not.toBeInTheDocument()
  })

  it('Start button is only visible for draft experiments', () => {
    render(<ExperimentsListClient experiments={MOCK_EXPERIMENTS} orgSlug="acme" />)

    // In "All" tab, CTA Button Test (draft) should have Start
    const startButtons = screen.getAllByRole('button', { name: /Start/i })
    // Only the draft experiment should show Start
    expect(startButtons).toHaveLength(1)

    // Running experiment (exp_2) should have Stop and Compute but not Start
    expect(screen.getByRole('button', { name: /Stop/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Compute/i })).toBeInTheDocument()

    // Start should not appear when filtering to Running
    fireEvent.click(screen.getByRole('tab', { name: 'Running' }))
    expect(screen.queryByRole('button', { name: /^Start/i })).not.toBeInTheDocument()
  })

  it('archives an experiment through an in-page confirmation without native dialogs', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock

    render(<ExperimentsListClient experiments={MOCK_EXPERIMENTS} orgSlug="acme" />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Archive experiment Headline Variation for acme' }),
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Archive experiment Headline Variation for acme?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes Headline Variation from active testing views. Results, winner history, and audit context stay in PiB.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm archive experiment Headline Variation for acme' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/ads/experiments/exp_2', { method: 'DELETE' })
    })

    expect(screen.getByText('Experiment Headline Variation archived.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Experiment Headline Variation')).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})
