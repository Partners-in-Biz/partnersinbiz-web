import { render, screen } from '@testing-library/react'
import { CrmSetupWizard } from '@/components/crm/setup/CrmSetupWizard'
import type { CrmSetupState, CrmStarterTemplate } from '@/lib/crm/setup/types'

const setup: CrmSetupState = {
  id: 'setup-org-1',
  orgId: 'org-1',
  salesProcess: 'new_sales',
  importStatus: 'not_started',
  gmailIntent: 'connect_later',
  pipelinePreference: 'simple_sales',
  selectedTemplateIds: ['pipeline-simple-sales', 'sequence-new-lead', 'segment-hot-leads'],
  appliedPipelineTemplateIds: [],
  createdAt: null,
  updatedAt: null,
}

const templates: CrmStarterTemplate[] = [
  {
    id: 'pipeline-simple-sales',
    kind: 'pipeline',
    name: 'Simple sales pipeline',
    description: 'A lightweight lead to close flow.',
    recommendedFor: ['simple_sales'],
    stages: [
      { id: 'qualified', label: 'Qualified', kind: 'open', order: 0, probability: 20 },
      { id: 'won', label: 'Won', kind: 'won', order: 1, probability: 100 },
      { id: 'lost', label: 'Lost', kind: 'lost', order: 2, probability: 0 },
    ],
  },
  {
    id: 'sequence-new-lead',
    kind: 'sequence',
    name: 'New lead follow-up',
    description: 'A short human follow-up sequence.',
    recommendedFor: ['simple_sales'],
    steps: [{ delayDays: 0, subject: 'Welcome', purpose: 'First response' }],
  },
  {
    id: 'segment-hot-leads',
    kind: 'segment',
    name: 'Hot leads',
    description: 'Recently active leads with intent.',
    recommendedFor: ['simple_sales'],
    rules: ['score > 70'],
  },
]

describe('CrmSetupWizard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/setup') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { setup, templates } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('names setup commands and template selectors by business outcome', async () => {
    render(<CrmSetupWizard />)

    expect(await screen.findByRole('heading', { name: 'CRM setup' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Open CSV import' })).toHaveLength(2)
    for (const link of screen.getAllByRole('link', { name: 'Open CSV import' })) {
      expect(link).toHaveAttribute('href', '/portal/capture-sources/import')
    }
    expect(screen.getByRole('link', { name: 'Review pipelines' })).toHaveAttribute('href', '/portal/settings/pipelines')
    expect(screen.getByRole('link', { name: 'Build sequences' })).toHaveAttribute('href', '/portal/settings/sequences')
    expect(screen.getByRole('button', { name: 'Save setup' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Simple sales pipeline starter template' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select New lead follow-up starter template' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Hot leads starter template' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Apply Simple sales pipeline template' })).toBeInTheDocument()
  })
})
