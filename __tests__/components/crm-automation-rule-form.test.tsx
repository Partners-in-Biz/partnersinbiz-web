import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AutomationRuleForm } from '@/components/crm/AutomationRuleForm'

describe('AutomationRuleForm', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('names every primary automation builder control with CRM language', () => {
    render(<AutomationRuleForm onSave={jest.fn()} onCancel={jest.fn()} />)

    expect(screen.getByRole('textbox', { name: 'Name the business outcome' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Choose the CRM moment' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Immediately' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'After delay' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))

    expect(screen.getByRole('combobox', { name: 'Action 1 type' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Action 1 notification recipient' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Action 1 notification message' })).toBeInTheDocument()
  })

  it('only offers active sequences for automation enrollment actions', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({
        data: {
          sequences: [
            { id: 'seq-active', name: 'Active welcome', status: 'active' },
            { id: 'seq-draft', name: 'Draft welcome', status: 'draft' },
          ],
        },
      }),
    } as Response)
    Object.defineProperty(global, 'fetch', { value: fetchMock, writable: true })

    render(<AutomationRuleForm onSave={jest.fn()} onCancel={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Action 1 type' }), {
      target: { value: 'enroll_in_sequence' },
    })

    expect(await screen.findByRole('option', { name: 'Active welcome' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Draft welcome' })).not.toBeInTheDocument()
  })

  it('saves automation rules through the provided scoped endpoint', async () => {
    const onSave = jest.fn()
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: 'rule-scoped',
          name: 'Notify owner',
          enabled: true,
          trigger: { event: 'contact.created' },
          actions: [{ type: 'send_notification', notificationMessage: 'Review the new lead' }],
          delayMinutes: 0,
        },
      }),
    } as Response)
    Object.defineProperty(global, 'fetch', { value: fetchMock, writable: true })

    render(
      <AutomationRuleForm
        endpoint="/api/v1/crm/automations?orgId=lumen-org"
        onSave={onSave}
        onCancel={jest.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Name the business outcome' }), {
      target: { value: 'Notify owner' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Action 1 notification message' }), {
      target: { value: 'Review the new lead' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/crm/automations?orgId=lumen-org',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'rule-scoped' }))
  })
})
