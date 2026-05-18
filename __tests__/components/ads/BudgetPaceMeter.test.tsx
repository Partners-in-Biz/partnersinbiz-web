/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { BudgetPaceMeter } from '@/components/ads/BudgetPaceMeter'

describe('BudgetPaceMeter', () => {
  it('renders 50% with emerald color', () => {
    const { container } = render(
      <BudgetPaceMeter percent={50} capCents={10000} spendCents={5000} />,
    )
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    const bar = container.querySelector('.bg-emerald-500')
    expect(bar).toBeInTheDocument()
    expect(bar).toHaveStyle({ width: '50%' })
  })

  it('renders 80% with yellow color', () => {
    const { container } = render(
      <BudgetPaceMeter percent={80} capCents={10000} spendCents={8000} />,
    )
    expect(screen.getByText('80.0%')).toBeInTheDocument()
    const bar = container.querySelector('.bg-yellow-500')
    expect(bar).toBeInTheDocument()
    expect(bar).toHaveStyle({ width: '80%' })
  })

  it('renders 95% with amber color', () => {
    const { container } = render(
      <BudgetPaceMeter percent={95} capCents={10000} spendCents={9500} />,
    )
    expect(screen.getByText('95.0%')).toBeInTheDocument()
    const bar = container.querySelector('.bg-amber-500')
    expect(bar).toBeInTheDocument()
    expect(bar).toHaveStyle({ width: '95%' })
  })

  it('renders 100%+ with red color and percent badge styled red', () => {
    const { container } = render(
      <BudgetPaceMeter percent={110} capCents={10000} spendCents={11000} />,
    )
    expect(screen.getByText('110.0%')).toBeInTheDocument()
    // bar should be clamped to 100%
    const bar = container.querySelector('.bg-red-500')
    expect(bar).toBeInTheDocument()
    expect(bar).toHaveStyle({ width: '100%' })
    // percent badge should have red styling
    const badge = screen.getByText('110.0%')
    expect(badge).toHaveClass('text-red-400')
  })
})
