import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/Button'

describe('Button', () => {
  it('uses the shared PiB button classes for every variant', () => {
    render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Primary' })).toHaveClass('pib-btn-primary')
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveClass('pib-btn-secondary')
    expect(screen.getByRole('button', { name: 'Ghost' })).toHaveClass('pib-btn-ghost')
    expect(screen.getByRole('button', { name: 'Danger' })).toHaveClass('pib-btn-danger')
  })
})
