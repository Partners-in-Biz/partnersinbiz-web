import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SenderPolicyEditor } from '@/components/email-marketing/SenderPolicyEditor'

describe('SenderPolicyEditor', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { policies: [
        { id: 'policy-1', name: 'Organisation sender', strategy: 'organisation_default', purpose: 'lifecycle', enabled: true },
        { id: 'policy-disabled', name: 'Old sender', strategy: 'fixed_identity', purpose: 'lifecycle', enabled: false },
      ] } }),
    }) as jest.Mock
  })

  it('loads enabled policies for the selected organisation and explains reply routing truthfully', async () => {
    const onChange = jest.fn()
    render(<SenderPolicyEditor orgId="org-1" value="" onChange={onChange} />)

    await waitFor(() => expect(screen.getByRole('option', { name: /organisation sender/i })).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/email-marketing/sender-policies?orgId=org-1')
    expect(screen.queryByRole('option', { name: /old sender/i })).not.toBeInTheDocument()
    expect(screen.getByText(/reply routing is assigned by the campaign delivery workflow/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Sender policy'), { target: { value: 'policy-1' } })
    expect(onChange).toHaveBeenCalledWith('policy-1')
  })
})
