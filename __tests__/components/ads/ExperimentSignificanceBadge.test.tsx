/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ExperimentSignificanceBadge } from '@/components/ads/ExperimentSignificanceBadge'

describe('ExperimentSignificanceBadge', () => {
  it('renders green "Significant (p<0.01)" when p<=0.01 and confident', () => {
    render(<ExperimentSignificanceBadge significance={{ pValue: 0.005, confident: true }} />)
    const badge = screen.getByText(/Significant \(p<0\.01\)/i)
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/green/)
  })

  it('renders emerald "Significant (p<0.05)" when p<=0.05 and confident', () => {
    render(<ExperimentSignificanceBadge significance={{ pValue: 0.03, confident: true }} />)
    const badge = screen.getByText(/Significant \(p<0\.05\)/i)
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/emerald/)
  })

  it('renders yellow "Trending" when p<=0.1 and not confident', () => {
    render(<ExperimentSignificanceBadge significance={{ pValue: 0.08, confident: false }} />)
    const badge = screen.getByText(/Trending/i)
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/yellow/)
  })

  it('renders gray "Not significant" when p>0.1', () => {
    render(<ExperimentSignificanceBadge significance={{ pValue: 0.42, confident: false }} />)
    const badge = screen.getByText(/Not significant \(p=0\.420\)/i)
    expect(badge).toBeInTheDocument()
  })

  it('renders "Awaiting data" when no significance provided', () => {
    render(<ExperimentSignificanceBadge />)
    expect(screen.getByText('Awaiting data')).toBeInTheDocument()
  })
})
