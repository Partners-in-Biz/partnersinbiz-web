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

  it('uses the shared danger pill treatment for a low score', () => {
    const { container } = render(<ScoreChip score={20} />)
    const chip = container.firstChild as HTMLElement
    expect(chip).toHaveClass('pib-pill', 'pib-pill-danger')
  })

  it('uses the shared warning pill treatment for a medium score', () => {
    const { container } = render(<ScoreChip score={50} />)
    const chip = container.firstChild as HTMLElement
    expect(chip).toHaveClass('pib-pill', 'pib-pill-warn')
  })

  it('uses the shared success pill treatment for a high score', () => {
    const { container } = render(<ScoreChip score={80} />)
    const chip = container.firstChild as HTMLElement
    expect(chip).toHaveClass('pib-pill', 'pib-pill-success')
  })

  it('renders distinct compact and default size treatments', () => {
    const { container: smContainer } = render(<ScoreChip score={50} size="sm" />)
    const { container: mdContainer } = render(<ScoreChip score={50} size="md" />)
    const smChip = smContainer.firstChild as HTMLElement
    const mdChip = mdContainer.firstChild as HTMLElement
    expect(smChip).toHaveClass('pib-pill')
    expect(mdChip).toHaveClass('pib-pill')
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
