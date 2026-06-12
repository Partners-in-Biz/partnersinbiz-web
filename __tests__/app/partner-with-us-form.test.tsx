import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PartnerWithUsForm from '@/app/(public)/partner-with-us/PartnerWithUsForm'

describe('PartnerWithUsForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'partner-interest-1' }),
    })
  })

  it('posts structured interest for the selected opportunity', async () => {
    render(
      <PartnerWithUsForm
        opportunity={{
          id: 'athleet-club-growth',
          title: 'Athleet club growth partner',
          sourcePath: '/partner-with-us/athleet-club-growth',
        }}
      />
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ava Partner' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ava@example.com' } })
    fireEvent.change(screen.getByLabelText('Phone / WhatsApp optional'), { target: { value: '067 000 0000' } })
    fireEvent.change(screen.getByLabelText('Company / location optional'), { target: { value: 'Durban North Sports Network' } })
    fireEvent.change(screen.getByLabelText('Useful sites or links optional'), { target: { value: 'https://example.com/club-profile' } })
    fireEvent.change(screen.getByLabelText('Reviewer access handoff'), { target: { value: 'demo_credentials' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'I can introduce ten wrestling clubs.' } })
    fireEvent.click(screen.getByLabelText(/I agree that Partners in Biz can contact me/i))
    fireEvent.click(screen.getByRole('button', { name: /Register interest/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))

    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    expect(requestInit).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const payload = JSON.parse(requestInit.body)
    expect(payload).toEqual({
      name: 'Ava Partner',
      email: 'ava@example.com',
      phone: '067 000 0000',
      company: 'Durban North Sports Network',
      website: 'https://example.com/club-profile',
      projectType: 'partnership',
      details: expect.stringContaining('Opportunity: Athleet club growth partner (athleet-club-growth)'),
      interest: {
        type: 'partner-opportunity',
        opportunityId: 'athleet-club-growth',
        opportunityTitle: 'Athleet club growth partner',
        notes: 'I can introduce ten wrestling clubs.',
        consent: true,
        source: '/partner-with-us/athleet-club-growth',
        links: 'https://example.com/club-profile',
        accessHandoff: 'demo_credentials',
        requestedArea: '',
      },
    })
    expect(await screen.findByText(/Interest registered/i)).toBeInTheDocument()
  })
})
