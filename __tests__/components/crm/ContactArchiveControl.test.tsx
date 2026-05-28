import { fireEvent, render, screen } from '@testing-library/react'
import { ContactArchiveControl } from '@/components/crm/ContactArchiveControl'

describe('ContactArchiveControl', () => {
  it('renders admin archive action context and invokes archive after confirmation', () => {
    const onArchive = jest.fn()
    jest.spyOn(window, 'confirm').mockReturnValue(true)

    render(<ContactArchiveControl contactName="Ava Owner" onArchive={onArchive} />)

    expect(screen.getByRole('button', { name: /Archive contact/i })).toBeInTheDocument()
    expect(screen.getByText(/Soft-archive this CRM record/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Archive contact/i }))

    expect(window.confirm).toHaveBeenCalledWith('Archive Ava Owner?')
    expect(onArchive).toHaveBeenCalledTimes(1)
  })

  it('does not archive when confirmation is cancelled', () => {
    const onArchive = jest.fn()
    jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<ContactArchiveControl contactName="Ava Owner" onArchive={onArchive} />)
    fireEvent.click(screen.getByRole('button', { name: /Archive contact/i }))

    expect(onArchive).not.toHaveBeenCalled()
  })
})
