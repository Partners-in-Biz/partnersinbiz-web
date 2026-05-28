import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactForm } from '@/components/admin/crm/ContactForm'

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
})
