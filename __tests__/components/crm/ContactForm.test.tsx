import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactForm } from '@/components/crm/ContactForm'

describe('ContactForm', () => {
  it('preserves and edits contact tags instead of clearing them on save', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)

    render(
      <ContactForm
        onSave={onSave}
        onCancel={jest.fn()}
        initial={{
          name: 'Ava Owner',
          email: 'ava@example.com',
          tags: ['vip', 'newsletter'],
        }}
      />,
    )

    const tagsInput = screen.getByLabelText('Tags')
    expect(tagsInput).toHaveValue('vip, newsletter')

    fireEvent.change(tagsInput, { target: { value: 'vip, key-account, newsletter' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Contact/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      tags: ['vip', 'key-account', 'newsletter'],
    }))
  })

  it('captures the contact owner so employee accountability is saved', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)

    render(
      <ContactForm
        onSave={onSave}
        onCancel={jest.fn()}
        initial={{
          name: 'Ava Owner',
          email: 'ava@example.com',
          assignedTo: '',
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'sales-lead-1' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Contact/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      assignedTo: 'sales-lead-1',
    }))
  })

  it('preserves timezone so admin and portal contact context stays actionable', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)

    render(
      <ContactForm
        onSave={onSave}
        onCancel={jest.fn()}
        initial={{
          name: 'Ava Owner',
          email: 'ava@example.com',
          timezone: 'Europe/London',
        }}
      />,
    )

    const timezoneInput = screen.getByLabelText('Timezone')
    expect(timezoneInput).toHaveValue('Europe/London')

    fireEvent.change(timezoneInput, { target: { value: 'Africa/Johannesburg' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Contact/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      timezone: 'Africa/Johannesburg',
    }))
  })

  it('names account-scoped contact fields and actions by company context', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)

    render(
      <ContactForm
        onSave={onSave}
        onCancel={jest.fn()}
        contextName="Acme Holdings"
        initial={{
          company: 'Acme Holdings',
          companyId: 'company-1',
          companyName: 'Acme Holdings',
        }}
      />,
    )

    expect(screen.getByLabelText('Contact name for Acme Holdings')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact email for Acme Holdings')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact phone for Acme Holdings')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact job title for Acme Holdings')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact department for Acme Holdings')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact timezone for Acme Holdings')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact company for Acme Holdings')).toHaveValue('Acme Holdings')
    expect(screen.getByLabelText('Contact owner for Acme Holdings')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact source for Acme Holdings')).toHaveValue('manual')
    expect(screen.getByLabelText('Contact type for Acme Holdings')).toHaveValue('lead')
    expect(screen.getByLabelText('Contact stage for Acme Holdings')).toHaveValue('new')
    expect(screen.getByLabelText('Contact tags for Acme Holdings')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact notes for Acme Holdings')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Primary contact role for Acme Holdings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save contact for Acme Holdings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel contact for Acme Holdings' })).toBeInTheDocument()
  })
})
