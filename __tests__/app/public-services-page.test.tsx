import { render, screen } from '@testing-library/react'
import type React from 'react'
import ServicesIndexPage from '@/app/(public)/services/page'

jest.mock('@/components/marketing/Reveal', () => ({
  Reveal: ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

describe('public services page', () => {
  it('links the services index into the Properties internal-link cluster', () => {
    render(<ServicesIndexPage />)

    expect(screen.getByRole('link', { name: /Partners in Biz Properties/i }))
      .toHaveAttribute('href', '/properties')
  })
})
