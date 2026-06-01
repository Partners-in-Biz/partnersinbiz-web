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

  it('applies red color class when score is 20', () => {
    const { container } = render(<ScoreChip score={20} />)
    const chip = container.firstChild as HTMLElement
    expect(chip.className).toMatch(/bg-red/)
    expect(chip.className).toMatch(/text-red/)
  })

  it('applies amber color class when score is 50', () => {
    const { container } = render(<ScoreChip score={50} />)
    const chip = container.firstChild as HTMLElement
    expect(chip.className).toMatch(/bg-amber/)
    expect(chip.className).toMatch(/text-amber/)
  })

  it('applies green color class when score is 80', () => {
    const { container } = render(<ScoreChip score={80} />)
    const chip = container.firstChild as HTMLElement
    expect(chip.className).toMatch(/bg-emerald/)
    expect(chip.className).toMatch(/text-emerald/)
  })

  it('applies smaller text class for size sm vs md', () => {
    const { container: smContainer } = render(<ScoreChip score={50} size="sm" />)
    const { container: mdContainer } = render(<ScoreChip score={50} size="md" />)
    const smChip = smContainer.firstChild as HTMLElement
    const mdChip = mdContainer.firstChild as HTMLElement
    expect(smChip.className).toMatch(/text-xs/)
    expect(mdChip.className).toMatch(/text-sm/)
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
