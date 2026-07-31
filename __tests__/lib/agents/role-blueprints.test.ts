import {
  WORKFORCE_BLUEPRINTS,
  resolveWorkforceBlueprint,
  WORKFORCE_BLUEPRINT_OPTIONS,
} from '@/lib/agents/role-blueprints'

describe('role-to-agent workforce blueprints', () => {
  it.each([
    ['People and Culture', 'Office Coordinator', 'people'],
    ['Finance', 'Payroll Administrator', 'finance'],
    ['Revenue', 'Account Executive', 'sales'],
    ['Brand', 'Social Media Manager', 'marketing'],
    ['Customer Service', 'Support Agent', 'customer_support'],
    ['Technology', 'Software Engineer', 'project_delivery'],
    ['Operations', 'Operations Manager', 'operations'],
    ['Leadership', 'Founder and CEO', 'executive'],
  ])('matches department %s to the %s blueprint', (department, jobTitle, expected) => {
    expect(resolveWorkforceBlueprint({ department, jobTitle })).toMatchObject({
      source: 'department',
      blueprint: { id: expected },
    })
  })

  it('uses job title when department is absent or not recognized', () => {
    expect(resolveWorkforceBlueprint({ department: 'Client Team', jobTitle: 'Finance Manager' })).toMatchObject({
      source: 'job_title',
      blueprint: { id: 'finance' },
    })
  })

  it('supports explicit blueprint override from a provided blueprintId', () => {
    expect(resolveWorkforceBlueprint({
      department: 'Finance',
      jobTitle: 'Generalist',
      blueprintId: 'marketing',
    })).toMatchObject({
      source: 'override',
      blueprint: { id: 'marketing' },
    })
  })

  it('fails safely to a general team and requests better member metadata', () => {
    const match = resolveWorkforceBlueprint({})

    expect(match).toMatchObject({ source: 'default', blueprint: { id: 'general' } })
    expect(match.blueprint.onboardingChecks).toContain('Add department and job title for a tailored team')
  })

  it('does not present specialist placeholders when a dedicated person exists', () => {
    expect(WORKFORCE_BLUEPRINTS.people.specialistGaps).toEqual([])
    expect(WORKFORCE_BLUEPRINTS.finance.specialistGaps).toEqual([])
    expect(WORKFORCE_BLUEPRINTS.people.recommendedAgentIds).toContain('people')
    expect(WORKFORCE_BLUEPRINTS.finance.recommendedAgentIds).toContain('finance')
  })

  it('keeps UI option metadata aligned with blueprint definitions', () => {
    const optionIds = WORKFORCE_BLUEPRINT_OPTIONS.map((option) => option.id)
    const blueprintIds = Object.keys(WORKFORCE_BLUEPRINTS)
    expect(optionIds).toEqual(blueprintIds)
  })
})
