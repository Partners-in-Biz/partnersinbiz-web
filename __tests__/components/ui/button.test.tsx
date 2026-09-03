import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/Button'

describe('Button', () => {
  it('delegates to Studio Button classes for every variant', () => {
    render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Primary' })).toHaveClass('st-btn', 'st-btn--primary')
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveClass('st-btn', 'st-btn--secondary')
    expect(screen.getByRole('button', { name: 'Ghost' })).toHaveClass('st-btn', 'st-btn--ghost')
    expect(screen.getByRole('button', { name: 'Danger' })).toHaveClass('st-btn', 'st-btn--danger')
  })

  it('maps deprecated lg size to Studio md and keeps sm', () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Small' })).toHaveClass('st-btn--sm')
    expect(screen.getByRole('button', { name: 'Large' })).toHaveClass('st-btn')
    expect(screen.getByRole('button', { name: 'Large' })).not.toHaveClass('st-btn--sm')
  })
})
