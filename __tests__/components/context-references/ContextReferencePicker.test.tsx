import { fireEvent, render, screen } from '@testing-library/react'

import { ContextReferencePicker } from '@/components/context-references/ContextReferencePicker'

describe('ContextReferencePicker', () => {
  it('shows reference type options for bare @ input', async () => {
    render(
      <ContextReferencePicker
        orgId="org-1"
        value={[]}
        onChange={jest.fn()}
        inputLabel="Add context reference"
      />,
    )

    const input = screen.getByLabelText('Add context reference')
    fireEvent.change(input, { target: { value: '@' } })

    expect(await screen.findByRole('button', { name: 'Use @projects:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @contacts:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @tasks:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @businesses:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @products:' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use @products:' }))

    expect(input).toHaveValue('@products:')
  })
})
