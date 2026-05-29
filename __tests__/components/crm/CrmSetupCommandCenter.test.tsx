import { render, screen } from '@testing-library/react'
import {
  CrmSetupCommandCenter,
  setupReadinessScore,
  type SetupCommandTemplate,
  type SetupCommandState,
} from '@/components/crm/setup/CrmSetupCommandCenter'

const templates: SetupCommandTemplate[] = [
  { id: 'pipe-simple', kind: 'pipeline', name: 'Simple sales', description: 'Pipeline', recommendedFor: ['simple_sales'] },
  { id: 'seq-welcome', kind: 'sequence', name: 'Welcome sequence', description: 'Sequence', recommendedFor: ['simple_sales'] },
  { id: 'seg-hot', kind: 'segment', name: 'Hot leads', description: 'Segment', recommendedFor: ['simple_sales'] },
]

const setup: SetupCommandState = {
  id: 'setup-1',
  orgId: 'org-1',
  salesProcess: 'new_sales',
  importStatus: 'planning',
  gmailIntent: 'connect_now',
  pipelinePreference: 'simple_sales',
  selectedTemplateIds: ['pipe-simple'],
  appliedPipelineTemplateIds: [],
  createdAt: null,
  updatedAt: null,
}

describe('CrmSetupCommandCenter', () => {
  it('scores readiness from import, gmail, selected templates, and applied pipeline state', () => {
    expect(setupReadinessScore(setup)).toBe(50)
    expect(setupReadinessScore({
      ...setup,
      importStatus: 'done',
      selectedTemplateIds: ['pipe-simple', 'seq-welcome'],
      appliedPipelineTemplateIds: ['pipe-simple'],
    })).toBe(100)
  })

  it('renders setup readiness, blockers, and direct next actions', () => {
    render(<CrmSetupCommandCenter setup={setup} recommendedTemplates={templates} />)

    expect(screen.getByText('Setup command center')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('Import plan in progress')).toBeInTheDocument()
    expect(screen.getByText('Pipeline not applied')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open csv import/i })).toHaveAttribute('href', '/portal/capture-sources/import')
    expect(screen.getByRole('link', { name: /review pipelines/i })).toHaveAttribute('href', '/portal/settings/pipelines')
    expect(screen.getByRole('link', { name: /build sequences/i })).toHaveAttribute('href', '/portal/settings/sequences')
  })
})
