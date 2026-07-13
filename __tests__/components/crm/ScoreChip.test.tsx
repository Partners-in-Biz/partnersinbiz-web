import React from 'react'
import { render, screen } from '@testing-library/react'
import { ScoreChip } from '@/components/crm/ScoreChip'

describe('ScoreChip', () => {
  it('names missing scores instead of showing a bare dash', () => {
    const { container } = render(<ScoreChip label="Lead score (formula)" kind="lead" />)
    expect(screen.getByText('Not scored')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()

    const chip = container.firstChild as HTMLElement
    expect(chip.title).toBe('Lead score (formula) — not scored yet')
  })

  it('renders distinct low, medium, and high score treatments', () => {
    const { container: lowContainer } = render(<ScoreChip score={20} />)
    const { container: mediumContainer } = render(<ScoreChip score={50} />)
    const { container: highContainer } = render(<ScoreChip score={80} />)
    const lowChip = lowContainer.firstChild as HTMLElement
    const mediumChip = mediumContainer.firstChild as HTMLElement
    const highChip = highContainer.firstChild as HTMLElement

    expect(lowChip).toHaveTextContent('20')
    expect(mediumChip).toHaveTextContent('50')
    expect(highChip).toHaveTextContent('80')
    expect(new Set([lowChip.className, mediumChip.className, highChip.className])).toHaveProperty('size', 3)
  })

  it('renders distinct compact and default size treatments', () => {
    const { container: smContainer } = render(<ScoreChip score={50} size="sm" />)
    const { container: mdContainer } = render(<ScoreChip score={50} size="md" />)
    const smChip = smContainer.firstChild as HTMLElement
    const mdChip = mdContainer.firstChild as HTMLElement
    expect(smChip.className).not.toBe(mdChip.className)
  })

  it('combines label and kind in tooltip title', () => {
    const { container } = render(
      <ScoreChip score={75} label="Lead score (formula)" kind="lead" />,
    )
    const chip = container.firstChild as HTMLElement
    expect(chip.title).toContain('Lead score (formula)')
    expect(chip.title).toContain('lead')
  })
})
