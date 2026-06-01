import { fireEvent, render, screen } from '@testing-library/react'
import { ContactArchiveControl } from '@/components/crm/ContactArchiveControl'

describe('ContactArchiveControl', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders admin archive action context and invokes archive after in-page confirmation', () => {
    const onArchive = jest.fn()
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<ContactArchiveControl contactName="Ava Owner" onArchive={onArchive} />)

    expect(screen.getByRole('button', { name: /Archive contact/i })).toBeInTheDocument()
    expect(screen.getByText(/Soft-archive this CRM record/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Archive contact/i }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Archive Ava Owner?' })).toBeInTheDocument()
    expect(screen.getByText('This contact will leave active CRM lists, but audit history and past activity stay recoverable.')).toBeInTheDocument()
    expect(onArchive).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive Ava Owner' }))

    expect(onArchive).toHaveBeenCalledTimes(1)
  })

  it('does not archive when the in-page confirmation is cancelled', () => {
    const onArchive = jest.fn()

    render(<ContactArchiveControl contactName="Ava Owner" onArchive={onArchive} />)
    fireEvent.click(screen.getByRole('button', { name: /Archive contact/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel archive contact' }))

    expect(screen.queryByRole('alertdialog', { name: 'Archive Ava Owner?' })).not.toBeInTheDocument()
    expect(onArchive).not.toHaveBeenCalled()
  })
})
