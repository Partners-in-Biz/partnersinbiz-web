import React from 'react'
import { render, screen } from '@testing-library/react'
import PortalData from '@/app/(portal)/portal/data/page'

describe('PortalData', () => {
  it('names data export commands without decorative icon text', () => {
    render(<PortalData />)

    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'download Download CSV' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code Download JSON' })).not.toBeInTheDocument()
  })
})
