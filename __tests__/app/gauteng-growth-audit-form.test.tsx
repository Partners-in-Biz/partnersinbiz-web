import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import GautengGrowthAuditForm from '@/app/(public)/gauteng-growth-audit/GautengGrowthAuditForm'

describe('GautengGrowthAuditForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'audit-lead-1' }),
    })
  })

  it('blocks incomplete audit requests before posting', () => {
    render(<GautengGrowthAuditForm />)

    fireEvent.click(screen.getByRole('button', { name: 'Get my free growth audit' }))

    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.getByText('Please add your name, email, business link, WhatsApp number, and biggest challenge.')).toBeInTheDocument()
  })

  it('blocks invalid email addresses before posting', () => {
    render(<GautengGrowthAuditForm />)

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ava Owner' } })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByLabelText('Business and online link'), { target: { value: 'Ava Florist - https://instagram.com/avaflorist' } })
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '067 000 0000' } })
    fireEvent.change(screen.getByLabelText('Biggest online growth challenge'), { target: { value: 'People like our posts but do not enquire.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get my free growth audit' }))

    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.getByText('Please use a valid email address so we can send the audit summary.')).toBeInTheDocument()
  })

  it('posts a qualified Gauteng audit enquiry payload', async () => {
    render(<GautengGrowthAuditForm />)

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ava Owner' } })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ava@example.com' } })
    fireEvent.change(screen.getByLabelText('Business and online link'), { target: { value: 'Ava Florist - https://instagram.com/avaflorist' } })
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '067 000 0000' } })
    fireEvent.change(screen.getByLabelText('Biggest online growth challenge'), { target: { value: 'People like our posts but do not enquire.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get my free growth audit' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))

    expect(global.fetch).toHaveBeenCalledWith('/api/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ava Owner',
        email: 'ava@example.com',
        company: 'Ava Florist - https://instagram.com/avaflorist',
        phone: '067 000 0000',
        website: 'Ava Florist - https://instagram.com/avaflorist',
        projectType: 'marketing',
        details: [
          'Gauteng Growth Audit request',
          '',
          'Business and online link: Ava Florist - https://instagram.com/avaflorist',
          'WhatsApp: 067 000 0000',
          'Biggest challenge: People like our posts but do not enquire.',
          'Offer: Website + 90-day SEO + social media sprint',
          'Source page: /gauteng-growth-audit',
        ].join('\n'),
      }),
    })

    expect(await screen.findByText('Your audit request is in.')).toBeInTheDocument()
  })

  it('shows a retryable error when the enquiry endpoint fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Submission failed' }),
    })

    render(<GautengGrowthAuditForm />)

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ava Owner' } })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ava@example.com' } })
    fireEvent.change(screen.getByLabelText('Business and online link'), { target: { value: 'Ava Florist - https://instagram.com/avaflorist' } })
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '067 000 0000' } })
    fireEvent.change(screen.getByLabelText('Biggest online growth challenge'), { target: { value: 'We need more leads from Google.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get my free growth audit' }))

    expect(await screen.findByText('Submission failed')).toBeInTheDocument()
  })
})
