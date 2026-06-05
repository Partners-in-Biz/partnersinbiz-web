import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalContactDetailPage from '@/app/(portal)/portal/contacts/[id]/page'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

let mockContactCustomFieldDefinitions: CustomFieldDefinition[] = []
let mockSuggestions: Array<{ action: string; reason: string; urgency: 'high' | 'medium' | 'low' }> = []
let mockContactOverrides: Record<string, unknown> = {}
let mockEmails: Array<{ id: string; subject?: string; status?: string; direction?: string; sentAt?: unknown; createdAt?: unknown }> = []
let mockActivities: Array<{ id: string; type?: string; summary?: string; notes?: string; createdAt?: unknown; createdByRef?: { uid?: string; displayName?: string } }> = []
let mockEnrollments: Array<{ id: string; sequenceId: string; sequenceName?: string; currentStep?: number; status?: string }> = []
let mockSequences: Array<{ id: string; name: string }> = []
let mockTeamMembers: Array<{ uid: string; firstName?: string; lastName?: string; jobTitle?: string }> = []
let mockSequenceEnrollError = ''
let mockSequenceUnenrollError = ''
let mockRouterPush = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'contact-1' }),
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/crm/ContactDealsPanel', () => ({
  ContactDealsPanel: ({ contactName }: { contactName?: string }) => (
    <div data-testid="contact-deals-panel">Deals for {contactName || 'contact name missing'}</div>
  ),
}))

jest.mock('@/components/crm/EntityScopedChat', () => ({
  EntityScopedChat: ({ entityName }: { entityName?: string }) => (
    <div data-testid="entity-scoped-chat">Chat for {entityName || 'contact name missing'}</div>
  ),
}))

describe('Portal contact detail page', () => {
  beforeEach(() => {
    mockContactCustomFieldDefinitions = []
    mockSuggestions = []
    mockContactOverrides = {}
    mockEmails = []
    mockActivities = []
    mockEnrollments = []
    mockSequences = []
    mockTeamMembers = []
    mockSequenceEnrollError = ''
    mockSequenceUnenrollError = ''
    mockRouterPush = jest.fn()
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = url.split('?')[0]
      if (path === '/api/v1/crm/contacts/contact-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              contact: {
                id: 'contact-1',
                orgId: 'org-1',
                name: 'Jane Client',
                email: 'jane@example.com',
                type: 'lead',
                stage: 'new',
                ...mockContactOverrides,
              },
            },
          }),
        } as Response)
      }
      if (path === '/api/v1/crm/custom-fields') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: mockContactCustomFieldDefinitions } }),
        } as Response)
      }
      if (path === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: mockTeamMembers }),
        } as Response)
      }
      if (path === '/api/v1/email') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: mockEmails }),
        } as Response)
      }
      if (path === '/api/v1/crm/activities') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { activities: mockActivities } }),
        } as Response)
      }
      if (path === '/api/v1/crm/contacts/contact-1/suggestions') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { suggestions: mockSuggestions } }),
        } as Response)
      }
      if (path === '/api/v1/crm/contacts/contact-1/enrollments') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { enrollments: mockEnrollments } }),
        } as Response)
      }
      if (path === '/api/v1/crm/sequences') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { sequences: mockSequences } }),
        } as Response)
      }
      if (path === '/api/v1/crm/sequences/seq-1/enrollments' && init?.method === 'POST') {
        return Promise.resolve({
          ok: !mockSequenceEnrollError,
          json: async () => mockSequenceEnrollError
            ? ({ error: mockSequenceEnrollError })
            : ({
                data: {
                  id: 'enrollment-1',
                  sequenceId: 'seq-1',
                  sequenceName: 'Leadership follow-up',
                  currentStep: 0,
                  status: 'active',
                },
              }),
        } as Response)
      }
      if (path === '/api/v1/crm/contacts/contact-1/recompute-score') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              update: {
                leadScore: 64,
                icpScore: 71,
                aiLeadScore: 82,
              },
            },
          }),
        } as Response)
      }
      if (path === '/api/v1/crm/ai/compose-email') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              subject: 'Executive follow-up',
              bodyText: 'Hi Jane, here is the next step we discussed.',
            },
          }),
        } as Response)
      }
      if (path === '/api/v1/crm/contacts/contact-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      if (path === '/api/v1/crm/sequences/seq-1/enrollments/enrollment-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: !mockSequenceUnenrollError,
          json: async () => mockSequenceUnenrollError ? ({ error: mockSequenceUnenrollError }) : ({ success: true }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock
  })

  it('turns an empty email history into an outreach readiness action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByRole('heading', { name: 'Start the first outreach thread' })).toBeInTheDocument()
    expect(screen.getByText('Email trail missing')).toBeInTheDocument()
    expect(screen.getByText('Send the first message so future replies, campaign touches, and account history are visible to every team member working this relationship.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send first email to Jane Client' }))

    expect(screen.getByRole('textbox', { name: 'Email subject for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Email message for Jane Client' })).toBeInTheDocument()
  })

  it('warns leaders when the contact detail looks like smoke-test setup data', async () => {
    mockContactOverrides = {
      name: 'Smoke composer focus contact 20260531172148',
      email: 'smoke-20260531172148@example.com',
    }

    render(<PortalContactDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Contact setup needs review' })).toBeInTheDocument()
    expect(screen.getByText('Smoke composer focus contact 20260531172148')).toBeInTheDocument()
    expect(screen.getByText(/looks like smoke-test contact data/)).toBeInTheDocument()

    const reviewButton = screen.getByRole('button', { name: 'Review contact setup for Smoke composer focus contact 20260531172148' })
    expect(reviewButton).toBeInTheDocument()
  })

  it('warns when contact details fail to load and gives leaders a retry path', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/contacts/contact-1') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Contact detail source unavailable' }),
        } as Response)
      }
      if (url === '/api/v1/crm/custom-fields?resource=contact') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [] }),
        } as Response)
      }
      if (url === '/api/v1/email?contactId=contact-1&limit=20') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      if (url === '/api/v1/crm/activities?contactId=contact-1&limit=50') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { activities: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1/suggestions') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { suggestions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1/enrollments') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { enrollments: [] } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<PortalContactDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Contact details could not load' })).toBeInTheDocument()
    expect(screen.getByText('Contact detail source unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Contact not found.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading contact details' }))

    await waitFor(() => {
      const contactRequests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => (
        String(url) === '/api/v1/crm/contacts/contact-1'
      ))
      expect(contactRequests).toHaveLength(2)
    })
  })

  it('shows an operational contact command loading state while relationship data resolves', () => {
    global.fetch = jest.fn(() => new Promise(() => undefined)) as jest.Mock

    render(<PortalContactDetailPage />)

    expect(screen.getByRole('heading', { name: 'Preparing contact command center' })).toBeInTheDocument()
    expect(screen.getByText('Loading relationship profile, owner coverage, activity, deals, and nurture context.')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Contact detail loading state' })).toBeInTheDocument()
    expect(screen.getByText('Relationship profile')).toBeInTheDocument()
    expect(screen.getByText('Activity timeline')).toBeInTheDocument()
    expect(screen.getByText('Pipeline context')).toBeInTheDocument()
  })

  it('moves the portal header email action into the active CRM composer', async () => {
    const scrollIntoView = jest.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Email Jane Client from contact command center' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Email subject for Jane Client' })).toHaveFocus())
    expect(screen.getByRole('textbox', { name: 'Email message for Jane Client' })).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('keeps the portal header call action inside the CRM call log', async () => {
    mockContactOverrides = { phone: '+27821234567' }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Log call with Jane Client from contact command center' }))

    expect(screen.getByRole('textbox', { name: 'Call notes for Jane Client' })).toBeInTheDocument()
  })

  it('renders portal lifecycle values as readable CRM labels', async () => {
    mockContactOverrides = {
      source: 'outreach',
      type: 'prospect',
      stage: 'proposal',
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('Proposal sent').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Prospect').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Outreach').length).toBeGreaterThan(0)
    expect(screen.getByRole('option', { name: 'Proposal sent' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Prospect' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Outreach' })).toBeInTheDocument()
  })

  it('turns first-viewport lifecycle chips into direct edit actions', async () => {
    const scrollIntoView = jest.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    mockContactOverrides = {
      type: 'prospect',
      stage: 'proposal',
      tags: ['priority'],
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit lifecycle stage Proposal sent for Jane Client' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Lifecycle stage for Jane Client' })).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: 'Edit contact type Prospect for Jane Client' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Contact type for Jane Client' })).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: 'Edit tag priority for Jane Client' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Tags for Jane Client' })).toHaveFocus())

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('turns captured contact detail values into direct outreach links', async () => {
    mockContactOverrides = {
      phone: '+27821234567',
      website: 'partnersinbiz.online',
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('link', { name: 'jane@example.com' })).toHaveAttribute('href', 'mailto:jane@example.com')
    expect(screen.getByRole('link', { name: '+27821234567' })).toHaveAttribute('href', 'tel:+27821234567')

    const websiteLink = screen.getByRole('link', { name: 'partnersinbiz.online' })
    expect(websiteLink).toHaveAttribute('href', 'https://partnersinbiz.online')
    expect(websiteLink).toHaveAttribute('target', '_blank')
    expect(websiteLink).toHaveAttribute('rel', 'noreferrer')
  })

  it('uses an in-page archive confirmation before removing a portal contact', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: /Archive/ }))

    expect(screen.getByRole('alertdialog', { name: 'Archive Jane Client?' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Archive Jane Client?' })).toBeInTheDocument()
    expect(screen.getByText('This contact will leave the active CRM list, but relationship history stays available for reporting and audit context.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1', { method: 'DELETE' })
    expect(screen.getByRole('button', { name: 'Cancel archive for Jane Client' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive for Jane Client' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1', { method: 'DELETE' })
    })
    expect(mockRouterPush).toHaveBeenCalledWith('/portal/contacts')
  })

  it('uses leadership-ready copy for the portal note composer', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Log first activity note for Jane Client' }))

    expect(screen.getByRole('textbox', { name: 'Relationship note for Jane Client' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Add note notes…')).not.toBeInTheDocument()
  })

  it('opens the activity note composer from contact list activity links', async () => {
    mockSearchParams = new URLSearchParams('activity=note')

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })
    expect(screen.getByRole('textbox', { name: 'Relationship note for Jane Client' })).toBeInTheDocument()
  })

  it('scopes portal contact detail data and actions to the requested organisation workspace', async () => {
    mockSearchParams = new URLSearchParams('orgId=org-1&orgSlug=lumen-speeds')
    mockSequences = [{ id: 'seq-1', name: 'Leadership follow-up' }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1?orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/custom-fields?resource=contact&orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/settings/team?orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/email?contactId=contact-1&limit=20&orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/activities?contactId=contact-1&limit=50&orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1/suggestions?orgId=org-1')
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1/enrollments?orgId=org-1')

    fireEvent.click(screen.getByRole('button', { name: 'Choose nurture sequence for Jane Client' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/sequences?orgId=org-1')
    })
  })

  it('preserves CRM company source context across contact detail navigation links', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'org-1',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    mockContactOverrides = {
      companyId: 'company-1',
      companyName: 'Lumen',
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    const scope = 'orgId=org-1&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen'
    expect(screen.getByRole('link', { name: /Contacts/ }))
      .toHaveAttribute('href', `/portal/contacts?${scope}`)
    expect(screen.getByRole('link', { name: 'Open linked company Lumen from contact header' }))
      .toHaveAttribute('href', `/portal/companies/company-1?${scope}`)
    expect(screen.getByRole('link', { name: 'Open linked company Lumen from company card' }))
      .toHaveAttribute('href', `/portal/companies/company-1?${scope}`)
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/companies/company-1?orgId=org-1')

    fireEvent.click(screen.getByRole('button', { name: 'Choose nurture sequence for Jane Client' }))

    expect(await screen.findByRole('link', { name: 'Build first sequence' }))
      .toHaveAttribute('href', `/portal/settings/sequences/new?${scope}`)
  })

  it('lets a busy team member discard unsaved contact profile edits', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.change(screen.getByPlaceholderText('+27...'), {
      target: { value: '+27 82 111 2222' },
    })

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard unsaved profile edits for Jane Client' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved profile edits for Jane Client' }))

    expect(screen.getByPlaceholderText('+27...')).toHaveValue('')
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard unsaved profile edits for Jane Client' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save profile changes for Jane Client' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('uses relationship-history copy for the empty activity metric', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('No relationship history yet')).toBeInTheDocument()
    expect(screen.queryByText('timeline records loaded')).not.toBeInTheDocument()
  })

  it('turns empty sequence enrollment into a nurture workflow action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('heading', { name: 'No nurture workflow enrolled' })).toBeInTheDocument()
    expect(screen.getByText('Enroll Jane Client into a sequence when outreach should happen on a repeatable cadence instead of relying on one-off reminders.')).toBeInTheDocument()
    expect(screen.queryByText('Not enrolled in any sequences.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open nurture enrollment for Jane Client' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enroll' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Choose nurture sequence for Jane Client' }))

    expect(await screen.findByRole('dialog', { name: 'Enroll Jane Client in a nurture sequence' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Enroll Jane Client in a nurture sequence' })).toBeInTheDocument()
    expect(screen.getByText('Choose an approved sequence so outreach steps, accountability, and follow-up timing are visible to the team from this contact record.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Nurture sequence for Jane Client' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Enroll Jane Client in selected nurture sequence' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel sequence enrollment for Jane Client' })).toBeInTheDocument()
  })

  it('names the sequence enrollment loading state for the active contact', async () => {
    const defaultFetch = global.fetch as jest.Mock
    const defaultFetchImpl = defaultFetch.getMockImplementation()
    defaultFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/contacts/contact-1/enrollments') {
        return new Promise(() => undefined)
      }
      return defaultFetchImpl!(input, init)
    })

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('Loading nurture workflow enrollment for Jane Client...')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading nurture workflow enrollment for Jane Client' })).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('turns an empty sequence picker into a setup action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Choose nurture sequence for Jane Client' }))

    expect(await screen.findByRole('heading', { name: 'Create a sequence before enrolling' })).toBeInTheDocument()
    expect(screen.getByText('This workspace needs at least one nurture sequence before Jane Client can be enrolled from the contact record.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Build first sequence' })).toHaveAttribute('href', '/portal/settings/sequences/new')
    expect(screen.getByRole('button', { name: 'Enroll Jane Client in selected nurture sequence' })).toBeDisabled()
  })

  it('shows sequence enrollment failures inside the modal', async () => {
    mockSequences = [{ id: 'seq-1', name: 'Leadership follow-up' }]
    mockSequenceEnrollError = 'Sequence is paused'

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Choose nurture sequence for Jane Client' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Nurture sequence for Jane Client' }), {
      target: { value: 'seq-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enroll Jane Client in selected nurture sequence' }))

    expect(await screen.findByText('Sequence is paused')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enroll Jane Client in selected nurture sequence' })).toBeEnabled()
    expect(screen.getByText('Leadership follow-up')).toBeInTheDocument()
  })

  it('confirms sequence unenrollment before removing a nurture workflow', async () => {
    mockEnrollments = [{
      id: 'enrollment-1',
      sequenceId: 'seq-1',
      sequenceName: 'Leadership follow-up',
      currentStep: 1,
      status: 'active',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Leadership follow-up')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review unenrollment for Jane Client from Leadership follow-up' }))

    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/sequences/seq-1/enrollments/enrollment-1', { method: 'DELETE' })
    expect(screen.getByRole('heading', { name: 'Pause this nurture workflow?' })).toBeInTheDocument()
    expect(screen.getByText('Removing Leadership follow-up stops the current sequence steps for Jane Client. The team can re-enroll them later if the follow-up cadence still applies.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm unenroll Jane Client from Leadership follow-up' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/sequences/seq-1/enrollments/enrollment-1', { method: 'DELETE' })
    })
    await waitFor(() => {
      expect(screen.queryByText('Leadership follow-up')).not.toBeInTheDocument()
    })
  })

  it('names incomplete sequence enrollment details instead of exposing raw ids', async () => {
    mockEnrollments = [{
      id: 'enrollment-raw-sequence',
      sequenceId: 'seq-raw-id',
      currentStep: 0,
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Sequence identity missing')).toBeInTheDocument()
    expect(screen.getByText('Step 1 · Enrollment status not set')).toBeInTheDocument()
    expect(screen.queryByText('seq-raw-id')).not.toBeInTheDocument()
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Review unenrollment for Jane Client from Sequence identity missing',
      })
    ).toBeInTheDocument()
  })

  it('renders sequence enrollment statuses as readable CRM labels', async () => {
    mockEnrollments = [{
      id: 'enrollment-paused',
      sequenceId: 'seq-1',
      sequenceName: 'Leadership follow-up',
      currentStep: 2,
      status: 'paused_by_rule',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Leadership follow-up')).toBeInTheDocument()
    expect(screen.getByText('Step 3 · Paused by rule')).toBeInTheDocument()
    expect(screen.queryByText(/paused_by_rule/i)).not.toBeInTheDocument()
  })

  it('shows sequence unenrollment failures without removing the workflow', async () => {
    mockSequenceUnenrollError = 'Enrollment already completed'
    mockEnrollments = [{
      id: 'enrollment-1',
      sequenceId: 'seq-1',
      sequenceName: 'Leadership follow-up',
      currentStep: 1,
      status: 'active',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Leadership follow-up')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review unenrollment for Jane Client from Leadership follow-up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unenroll Jane Client from Leadership follow-up' }))

    expect(await screen.findByText('Enrollment already completed')).toBeInTheDocument()
    expect(screen.getByText('Leadership follow-up')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm unenroll Jane Client from Leadership follow-up' })).toBeEnabled()
  })

  it('turns an empty activity timeline into a first-note action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Relationship activity missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "Start Jane Client's activity trail" })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Log the first note, call, email, or meeting so the whole team can see what happened, who followed up, and what should happen next.'
      )
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Log first activity note for Jane Client' }))

    expect(screen.getByPlaceholderText('Add a relationship note, handoff, or context…')).toBeInTheDocument()
  })

  it('turns a missing company into a profile linking action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Link company for Jane Client' }))

    expect(screen.getByPlaceholderText('Search companies…')).toHaveFocus()
  })

  it('turns an unlinked company name into a profile linking action', async () => {
    mockContactOverrides = { company: 'Acme Holdings' }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('Acme Holdings').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Link company for Jane Client' }))

    expect(screen.getByPlaceholderText('Search companies…')).toHaveFocus()
  })

  it('turns empty contact custom fields into a focused capture action', async () => {
    mockContactCustomFieldDefinitions = [{
      id: 'field-1',
      orgId: 'org-1',
      resource: 'contact',
      key: 'decision_role',
      label: 'Decision role',
      type: 'text',
      required: false,
      order: 0,
      createdAt: null,
      updatedAt: null,
    }]

    render(<PortalContactDetailPage />)

    expect(await screen.findByText('No custom fields set.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Capture custom fields for Jane Client' }))

    expect(screen.getByLabelText('Decision role')).toHaveFocus()
  })

  it('turns the company card empty state into a company picker action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Link company from company card for Jane Client' }))

    expect(screen.getByPlaceholderText('Search companies…')).toHaveFocus()
  })

  it('turns a missing phone into a profile completion action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add phone for Jane Client' }))

    expect(screen.getByPlaceholderText('+27...')).toHaveFocus()
  })

  it('keeps missing details visible instead of hiding empty fields', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('No phone captured')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add phone from details for Jane Client' }))

    expect(screen.getByPlaceholderText('+27...')).toHaveFocus()
  })

  it('turns lifecycle detail values into direct profile edit actions', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit source Manual entry for Jane Client from details' }))
    expect(screen.getByRole('combobox', { name: 'Contact source for Jane Client' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Edit contact type Lead for Jane Client from details' }))
    expect(screen.getByRole('combobox', { name: 'Contact type for Jane Client' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Edit lifecycle stage New lead for Jane Client from details' }))
    expect(screen.getByRole('combobox', { name: 'Lifecycle stage for Jane Client' })).toHaveFocus()
  })

  it('turns first-viewport contact identity into direct email phone and company links', async () => {
    mockContactOverrides = {
      phone: '+27825550123',
      companyId: 'company-1',
      companyName: 'Acme Holdings',
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('link', { name: 'Email jane@example.com from contact header' }))
      .toHaveAttribute('href', 'mailto:jane@example.com')
    expect(screen.getByRole('link', { name: 'Call +27825550123 from contact header' }))
      .toHaveAttribute('href', 'tel:+27825550123')
    expect(screen.getByRole('link', { name: 'Open linked company Acme Holdings from contact header' }))
      .toHaveAttribute('href', '/portal/companies/company-1')
  })

  it('uses the contact identity fallback across sparse contact workflows', async () => {
    mockContactOverrides = { name: '' }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Contact name').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('Unnamed contact')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send first email to Unnamed contact' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log first activity note for Unnamed contact' })).toBeInTheDocument()
    expect(screen.getByTestId('contact-deals-panel')).toHaveTextContent('Deals for Unnamed contact')

    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting from engagement cockpit with Unnamed contact' }))

    expect(screen.getByDisplayValue('Meeting with Unnamed contact')).toBeInTheDocument()
  })

  it('names edit profile fields with the active contact context', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('textbox', { name: 'Contact name for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Email address for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Phone number for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Job title for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Department for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Timezone for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Website for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Contact source for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Contact type for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Lifecycle stage for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Relationship owner for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Tags for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Linked company for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Relationship notes for Jane Client' })).toBeInTheDocument()
  })

  it('keeps relationship notes visible as contact detail context', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('No relationship notes captured')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add relationship notes from details for Jane Client' }))

    expect(screen.getByPlaceholderText('Add a note about this contact…')).toHaveFocus()
  })

  it('turns a missing company profile gap into a link-company action', async () => {
    mockContactOverrides = {
      phone: '+27821234567',
      assignedTo: 'owner-1',
      website: 'https://example.com',
      notes: 'Prefers quarterly leadership reviews.',
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('Missing company.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Link company for Jane Client from profile strength' }))

    expect(screen.getByRole('combobox', { name: 'Linked company for Jane Client' })).toHaveFocus()
  })

  it('turns a missing owner profile gap into an accountability action', async () => {
    mockContactOverrides = {
      phone: '+27821234567',
      companyId: 'company-1',
      companyName: 'Acme Holdings',
      website: 'https://example.com',
      notes: 'Prefers quarterly leadership reviews.',
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('Missing owner.')).toBeInTheDocument()
    expect(screen.queryByText('The core contact profile is complete enough for segmentation, scoring, and follow-up.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assign owner for Jane Client from profile strength' }))

    expect(screen.getByRole('combobox', { name: 'Relationship owner for Jane Client' })).toHaveFocus()
  })

  it('summarizes relationship risk with direct leadership actions', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('heading', { name: 'Relationship risk brief' })).toBeInTheDocument()
    expect(screen.getByText('4 open risks need attention before this relationship is leadership-ready.')).toBeInTheDocument()
    expect(screen.getByText('No accountable owner')).toBeInTheDocument()
    expect(screen.getByText('No linked company')).toBeInTheDocument()
    expect(screen.getByText('No relationship touch logged')).toBeInTheDocument()
    expect(screen.getByText('No score available')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assign owner for Jane Client from relationship risk brief' }))
    expect(screen.getByRole('combobox', { name: 'Relationship owner for Jane Client' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Link company for Jane Client from relationship risk brief' }))
    expect(screen.getByRole('combobox', { name: 'Linked company for Jane Client' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Log relationship touch for Jane Client from relationship risk brief' }))
    expect(screen.getByRole('textbox', { name: 'Relationship note for Jane Client' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recompute score for Jane Client from relationship risk brief' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/crm/contacts/contact-1/recompute-score',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('turns a missing last touch insight into an activity action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('No touch logged').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Log touch for Jane Client from last touch insight' }))

    expect(screen.getByPlaceholderText('Add a relationship note, handoff, or context…')).toBeInTheDocument()
  })

  it('turns stale last contacted detail into a fresh touch action', async () => {
    mockContactOverrides = {
      lastContactedAt: new Date('2026-01-01T08:00:00.000Z'),
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Log fresh touch for Jane Client from last contacted detail' }))

    expect(screen.getByRole('textbox', { name: 'Relationship note for Jane Client' })).toBeInTheDocument()
  })

  it('turns a follow-up suggestion into a prefilled email action', async () => {
    mockSuggestions = [{
      action: 'Send a follow-up',
      reason: 'No activity in 7+ days',
      urgency: 'high',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Start suggested action: Send a follow-up for Jane Client' })[0])

    expect(screen.getByDisplayValue('Send a follow-up')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument()
  })

  it('turns the command-center next best action into a workflow action', async () => {
    mockSuggestions = [{
      action: 'Send a follow-up',
      reason: 'No activity in 7+ days',
      urgency: 'high',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Act on top recommendation: Send a follow-up for Jane Client' }))

    expect(screen.getByDisplayValue('Send a follow-up')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument()
  })

  it('names sparse portal next-best-action suggestions instead of rendering blank recommendation cards', async () => {
    mockSuggestions = [{
      action: '',
      reason: '',
      urgency: 'medium',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('Suggested action missing').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Suggestion reason missing').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Act on top recommendation: Suggested action missing for Jane Client' }))

    expect(screen.getByPlaceholderText('Add a relationship note, handoff, or context…')).toHaveValue('Suggestion reason missing')
  })

  it('turns an empty email thread insight into a send action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Send email to Jane Client from email thread insight' }))

    expect(screen.getByPlaceholderText('Subject…')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument()
  })

  it('turns an empty activity insight into a note action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Log activity for Jane Client from activity insight' }))

    expect(screen.getByRole('textbox', { name: 'Relationship note for Jane Client' })).toBeInTheDocument()
  })

  it('wires engagement cockpit actions to contact composers', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting from engagement cockpit with Jane Client' }))

    expect(screen.getByRole('textbox', { name: 'Meeting title for Jane Client' })).toHaveValue('Meeting with Jane Client')
    expect(screen.getByLabelText('Meeting start time for Jane Client')).toBeInTheDocument()
    expect(screen.getByLabelText('Meeting end time for Jane Client')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Meeting link for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Meeting agenda or notes for Jane Client' })).toBeInTheDocument()
  })

  it('blocks meeting scheduling when the end time is before the start time', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting with Jane Client' }))
    fireEvent.change(screen.getByLabelText('Meeting start time for Jane Client'), { target: { value: '2026-06-02T15:00' } })
    fireEvent.change(screen.getByLabelText('Meeting end time for Jane Client'), { target: { value: '2026-06-02T14:30' } })

    expect(screen.getByRole('alert')).toHaveTextContent('Meeting end time must be after the start time.')
    expect(screen.getByRole('button', { name: 'Cancel meeting composer for Jane Client' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule meeting with Jane Client from activity composer' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Schedule' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting with Jane Client from activity composer' }))

    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1/schedule-meeting', expect.any(Object))
  })

  it('names activity toolbar actions with the active contact context', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('button', { name: 'Log call with Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send email to Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log note for Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send SMS to Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule meeting with Jane Client' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft email with AI for Jane Client' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument()
  })

  it('names phone-backed activity message fields with the active contact context', async () => {
    mockContactOverrides = { phone: '+27821234567' }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Send SMS to Jane Client' }))
    expect(screen.getByRole('textbox', { name: 'SMS message for Jane Client' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log call with Jane Client' }))
    expect(screen.getByRole('textbox', { name: 'Call notes for Jane Client' })).toBeInTheDocument()
  })

  it('turns SMS on a contact without a phone into a phone capture action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Send SMS to Jane Client' }))

    expect(screen.getByRole('heading', { name: 'Add a phone number before SMS' })).toBeInTheDocument()
    expect(screen.getByText("Capture Jane Client's phone number before the team tries to send a text message from CRM.")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('SMS message…')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add phone before sending SMS to Jane Client' }))

    expect(screen.getByPlaceholderText('+27...')).toHaveFocus()
  })

  it('turns activity call on a contact without a phone into a phone capture action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Log call with Jane Client' }))

    expect(screen.getByRole('heading', { name: 'Add a phone number before calling' })).toBeInTheDocument()
    expect(screen.getByText("Capture Jane Client's phone number before the team logs a call from CRM.")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Add call notes…')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add phone before logging a call with Jane Client' }))

    expect(screen.getByPlaceholderText('+27...')).toHaveFocus()
  })

  it('turns activity email on a contact without an email into an email capture action', async () => {
    mockContactOverrides = { email: '' }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Send email to Jane Client' }))

    expect(screen.getByRole('heading', { name: 'Add an email address before outreach' })).toBeInTheDocument()
    expect(screen.getByText("Capture Jane Client's email address before the team sends outreach from CRM.")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Subject…')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Message…')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add email before sending outreach to Jane Client' }))

    expect(screen.getByPlaceholderText('name@example.com')).toHaveFocus()
  })

  it('moves a generated AI email draft into the CRM email composer', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Draft email with AI for Jane Client' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'AI email purpose for Jane Client' }), {
      target: { value: 'Follow up after leadership review' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI email draft for Jane Client' }))

    expect(await screen.findByText('Executive follow-up')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use AI draft in email composer for Jane Client' }))

    expect(screen.getByDisplayValue('Executive follow-up')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Hi Jane, here is the next step we discussed.')).toBeInTheDocument()
    expect(screen.queryByText('AI email composer')).not.toBeInTheDocument()
  })

  it('names the AI draft copy action by draft subject and active contact', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Draft email with AI for Jane Client' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'AI email purpose for Jane Client' }), {
      target: { value: 'Follow up after leadership review' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI email draft for Jane Client' }))

    expect(await screen.findByText('Executive follow-up')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy AI draft Executive follow-up for Jane Client' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy to clipboard' })).not.toBeInTheDocument()
  })

  it('turns a missing best score insight into a recompute action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Recompute score for Jane Client from best score insight' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1/recompute-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeAi: true }),
      })
    })
    await waitFor(() => {
      expect(screen.getAllByText('82').length).toBeGreaterThan(0)
    })
  })

  it('names missing command-center KPI values instead of showing bare dashes', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('Not scored')).toBeInTheDocument()
    expect(screen.getByText('No touch yet')).toBeInTheDocument()
    expect(screen.queryAllByText('—')).toHaveLength(0)
  })

  it('names missing email and activity timestamps on contact history rows', async () => {
    mockEmails = [{
      id: 'email-1',
      subject: 'Proposal follow-up',
      status: 'sent',
      direction: 'outbound',
    }]
    mockActivities = [{
      id: 'activity-1',
      type: 'note',
      summary: 'Discussed implementation handoff',
      createdByRef: { displayName: 'Mandy Manager' },
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Proposal follow-up')).toBeInTheDocument()
    expect(screen.getByText('Sent · Email time not captured')).toBeInTheDocument()
    expect(screen.getByText('Discussed implementation handoff')).toBeInTheDocument()
    expect(screen.getByText('Mandy Manager · Activity time not captured')).toBeInTheDocument()
    expect(screen.queryAllByText('—')).toHaveLength(0)
  })

  it('names incomplete email history rows instead of showing generic placeholders', async () => {
    mockEmails = [{
      id: 'email-sparse',
      subject: '',
      direction: 'outbound',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Email subject missing')).toBeInTheDocument()
    expect(screen.getByText('Email status not captured · Email time not captured')).toBeInTheDocument()
    expect(screen.queryByText('(no subject)')).not.toBeInTheDocument()
  })

  it('turns populated email history rows into follow-up composer actions', async () => {
    mockEmails = [{
      id: 'email-1',
      subject: 'Proposal follow-up',
      status: 'sent',
      direction: 'outbound',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Proposal follow-up')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Follow up on Proposal follow-up with Jane Client' }))

    expect(screen.getByRole('textbox', { name: 'Email subject for Jane Client' })).toHaveValue('Re: Proposal follow-up')
    expect(screen.getByRole('textbox', { name: 'Email message for Jane Client' })).toBeInTheDocument()
  })

  it('renders saved email status keys as readable history labels', async () => {
    mockEmails = [{
      id: 'email-1',
      subject: 'Retrying proposal follow-up',
      status: 'queued_for_retry',
      direction: 'outbound',
      createdAt: null,
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Retrying proposal follow-up')).toBeInTheDocument()
    expect(screen.getByText('Queued for retry · Email time not captured')).toBeInTheDocument()
    expect(screen.queryByText(/queued_for_retry/)).not.toBeInTheDocument()
  })

  it('classifies saved email direction keys as readable sent and received history', async () => {
    mockEmails = [{
      id: 'email-1',
      subject: 'CEO proposal sent',
      status: 'sent',
      direction: 'outbound_email',
    }, {
      id: 'email-2',
      subject: 'CEO replied',
      status: 'replied',
      direction: 'incoming_reply',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('CEO proposal sent')).toBeInTheDocument()
    expect(screen.getByText('CEO replied')).toBeInTheDocument()
    expect(screen.getByText('1 sent / 1 received')).toBeInTheDocument()
    expect(screen.getByTitle('Sent email')).toBeInTheDocument()
    expect(screen.getByTitle('Received email')).toBeInTheDocument()
    expect(screen.queryByTitle('outbound_email')).not.toBeInTheDocument()
    expect(screen.queryByTitle('incoming_reply')).not.toBeInTheDocument()
  })

  it('names incomplete activity timeline rows instead of exposing raw activity snapshots', async () => {
    mockActivities = [{
      id: 'activity-raw',
      type: 'stage_change',
      summary: '',
      notes: '',
      createdByRef: { uid: 'uid-activity-1' },
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Activity summary missing')).toBeInTheDocument()
    expect(screen.getByText('Activity actor identity missing · Activity time not captured')).toBeInTheDocument()
    expect(screen.queryByText('stage_change')).not.toBeInTheDocument()
    expect(screen.queryByText('uid-activity-1')).not.toBeInTheDocument()
  })

  it('turns populated activity timeline rows into continuation note actions', async () => {
    mockActivities = [{
      id: 'activity-1',
      type: 'note',
      summary: 'Discussed implementation handoff',
      createdByRef: { displayName: 'Mandy Manager' },
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Discussed implementation handoff')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue from activity Discussed implementation handoff with Jane Client' }))

    expect(screen.getByRole('textbox', { name: 'Relationship note for Jane Client' })).toHaveValue('Follow-up from: Discussed implementation handoff')
  })

  it('names the activity timeline pagination action by active contact', async () => {
    mockActivities = Array.from({ length: 50 }, (_, index) => ({
      id: `activity-${index}`,
      type: 'note',
      summary: `Timeline note ${index + 1}`,
    }))

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByRole('button', { name: 'Load more activity for Jane Client' })).toBeInTheDocument()
  })

  it('turns an unassigned relationship owner into an accountability action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Assign owner for Jane Client from relationship ownership' }))

    expect(screen.getByDisplayValue('Unassigned')).toHaveFocus()
  })

  it('names sparse team member options instead of exposing raw owner ids', async () => {
    mockTeamMembers = [{ uid: 'uid-owner-raw' }]
    mockContactOverrides = {
      assignedTo: 'uid-owner-raw',
      assignedToRef: { uid: 'uid-owner-raw' },
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByRole('option', { name: 'Team member identity missing' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'uid-owner-raw' })).not.toBeInTheDocument()
    expect(screen.queryByText('uid-owner-raw')).not.toBeInTheDocument()
  })

  it('turns weak source provenance into a source review action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Source provenance weak')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review source provenance for Jane Client from relationship ownership' }))

    expect(screen.getByDisplayValue('Manual entry')).toHaveFocus()
  })

  it('names incomplete ownership actor snapshots instead of exposing raw team member ids', async () => {
    mockContactOverrides = {
      assignedTo: 'uid-owner-1',
      assignedToRef: { uid: 'uid-owner-1' },
      source: 'outreach',
      capturedFromId: 'lead_form',
      createdByRef: { uid: 'uid-creator-1' },
      updatedByRef: { uid: 'uid-updater-1' },
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Owner identity missing')).toBeInTheDocument()
    expect(screen.getByText('Creator identity missing')).toBeInTheDocument()
    expect(screen.getByText('Updater identity missing')).toBeInTheDocument()
    expect(screen.getAllByText('Team snapshot details not captured').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('uid-owner-1')).not.toBeInTheDocument()
    expect(screen.queryByText('uid-creator-1')).not.toBeInTheDocument()
    expect(screen.queryByText('uid-updater-1')).not.toBeInTheDocument()
  })

  it('turns missing identity intelligence into profile field actions', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add role for Jane Client from identity intelligence' }))
    expect(screen.getByPlaceholderText('Decision maker, Finance Director...')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Add department for Jane Client from identity intelligence' }))
    expect(screen.getByPlaceholderText('Finance, Operations...')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Add timezone for Jane Client from identity intelligence' }))
    expect(screen.getByPlaceholderText('Africa/Johannesburg')).toHaveFocus()
  })
})
