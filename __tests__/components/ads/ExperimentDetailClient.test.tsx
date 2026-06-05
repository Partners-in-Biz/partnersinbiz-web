/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ExperimentDetailClient, type ExperimentDetailPlain } from '@/components/ads/ExperimentDetailClient'

jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
  Link.displayName = 'Link'
  return Link
})

const EXPERIMENT: ExperimentDetailPlain = {
  id: 'exp_1',
  name: 'Headline Variation',
  description: 'Test sharper conversion copy.',
  status: 'running',
  platform: 'google',
  level: 'ad',
  parentEntityId: 'adset_1',
  sourceEntityId: 'ad_1',
  successMetric: 'conversions',
  minDays: 7,
  significanceThreshold: 0.05,
  autoWinner: false,
  startedAt: { seconds: Math.floor(Date.now() / 1000) - 3 * 86400 },
  variants: [
    { id: 'control', name: 'Control headline', trafficPercent: 50 },
    { id: 'variant', name: 'Sharper headline', trafficPercent: 50 },
  ],
  significance: {
    pValue: 0.04,
    confident: true,
    winnerVariantId: 'variant',
  },
}

describe('ExperimentDetailClient', () => {
  it('stops a running experiment with inline feedback instead of reloading', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { ...EXPERIMENT, status: 'paused' } }),
    })
    global.fetch = fetchMock

    render(<ExperimentDetailClient experiment={EXPERIMENT} results={[]} orgSlug="acme" />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop experiment Headline Variation' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/ads/experiments/exp_1/stop', {
        method: 'POST',
        headers: undefined,
        body: undefined,
      })
    })

    expect(await screen.findByText('Experiment paused.')).toBeInTheDocument()
    expect(screen.getByText('paused')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop experiment Headline Variation' })).not.toBeInTheDocument()
  })

  it('archives an experiment through an in-page confirmation without native dialogs or redirect', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock

    render(<ExperimentDetailClient experiment={EXPERIMENT} results={[]} orgSlug="acme" />)

    fireEvent.click(screen.getByRole('button', { name: 'Archive experiment Headline Variation for acme' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Archive experiment Headline Variation for acme?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes Headline Variation from active testing controls. Results, variants, and winner history stay in PiB.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm archive experiment Headline Variation for acme' }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/ads/experiments/exp_1', { method: 'DELETE' })
    })

    expect(screen.getByText('Experiment Headline Variation archived.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive experiment Headline Variation for acme' })).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})
