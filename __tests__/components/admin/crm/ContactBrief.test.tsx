import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ContactBrief from '@/components/admin/crm/ContactBrief'

describe('ContactBrief', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
  })

  it('turns a missing AI brief into a contact-aware relationship intelligence action', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { brief: 'Ava is waiting on the proposal recap.' } }),
    } as Response)

    render(<ContactBrief contactId="contact-1" contactName="Ava Owner" />)

    expect(screen.getByText('Relationship intelligence missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "Generate Ava Owner's CRM brief" })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Create a concise brief from activity, email, deal, and profile context so the next employee has the relationship history before they act.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Generate relationship brief for Ava Owner' }))

    await waitFor(() => {
      expect(screen.getByText('Ava is waiting on the proposal recap.')).toBeInTheDocument()
    })
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/ai/contact-brief/contact-1')
  })

  it('shows a retryable brief generation error without hiding the command', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Brief service unavailable' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { brief: 'Retry produced the relationship brief.' } }),
      } as Response)

    render(<ContactBrief contactId="contact-1" contactName="Ava Owner" />)

    fireEvent.click(screen.getByRole('button', { name: 'Generate relationship brief for Ava Owner' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Brief service unavailable')
    })
    expect(screen.getByRole('button', { name: 'Retry relationship brief for Ava Owner' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry relationship brief for Ava Owner' }))

    await waitFor(() => {
      expect(screen.getByText('Retry produced the relationship brief.')).toBeInTheDocument()
    })
  })
})
