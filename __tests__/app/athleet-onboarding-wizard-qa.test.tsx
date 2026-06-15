import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AthleetOnboardingForm from '@/app/(public)/start/[product]/AthleetOnboardingForm'

const fetchMock = jest.fn()

describe('Athleet onboarding wizard QA flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'submission-qa-1', contactId: 'contact-qa-1' }),
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('validates required onboarding steps, preserves responsive wizard content, and submits the reviewed configuration', async () => {
    render(<AthleetOnboardingForm />)

    expect(screen.getByText('Step 1 of 10')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Club Identity' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText('Club name is required.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('ATLAS WRESTLING CLUB'), { target: { value: 'QA Wrestling Club' } })
    fireEvent.change(screen.getByPlaceholderText('AUSTIN'), { target: { value: 'Johannesburg' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('heading', { name: 'Brand & Design' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('heading', { name: 'Contact Details' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText('Contact email is required.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('coach@yourclub.com'), { target: { value: 'coach@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('heading', { name: 'Social Media' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('heading', { name: 'Coaches & Staff' })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('JOHN SMITH'), { target: { value: 'Coach QA' } })
    fireEvent.click(screen.getByRole('button', { name: /add another coach/i }))
    expect(screen.getByText('Coach 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('heading', { name: 'Programs & Divisions' })).toBeInTheDocument()
    expect(screen.getAllByText(/Program \d/)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('heading', { name: 'Club Stats' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Athletes Trained')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('heading', { name: 'Features' })).toBeInTheDocument()
    expect(screen.getByText('Online Registrations')).toBeInTheDocument()
    expect(screen.getByText('Email Notifications')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Email Notifications').closest('div')!.parentElement!.querySelector('button')!)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('heading', { name: 'Domain & Admin' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText('Your name is required.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('atlasclub'), { target: { value: 'qa-club' } })
    fireEvent.change(screen.getByPlaceholderText('you@yourclub.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('JOHN SMITH'), { target: { value: 'Admin QA' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('heading', { name: 'Review & Submit' })).toBeInTheDocument()
    expect(screen.getByText('QA Wrestling Club')).toBeInTheDocument()
    expect(screen.getByText('qa-club.athleet.space')).toBeInTheDocument()
    expect(screen.getByText('Admin QA')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    expect(screen.getByText('Registrations · Payments · Scheduling · Athlete Records · Tournaments · Parent Portal')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /submit configuration/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, options] = fetchMock.mock.calls[0]
    const payload = JSON.parse((options as RequestInit).body as string)

    expect(url).toBe('/api/v1/onboarding')
    expect(options).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    expect(payload).toMatchObject({
      product: 'athleet-management',
      clubName: 'QA Wrestling Club',
      city: 'Johannesburg',
      contactEmail: 'coach@example.com',
      adminName: 'Admin QA',
      adminEmail: 'admin@example.com',
      subdomainPreference: 'qa-club',
      enableEmailNotifications: false,
    })

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Configuration Received' })).toBeInTheDocument())
    expect(screen.getByText('Ref: submission-qa-1')).toBeInTheDocument()
  })
})
