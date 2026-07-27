import {
  normalizeProjectPlaybookTemplate,
  playbookTemplateSteps,
  validateProjectPlaybookTemplate,
} from '@/lib/projects/playbooks'

describe('project playbook templates', () => {
  it('adapts legacy string steps into structured agent-ready steps', () => {
    const template = normalizeProjectPlaybookTemplate({ templateSteps: ['Discovery', 'Build', 'QA'] })
    expect(template).toEqual(expect.objectContaining({ schemaVersion: 1 }))
    expect(template.steps).toEqual([
      expect.objectContaining({ stepId: 'step-1', title: 'Discovery', spec: 'Discovery', dependsOnStepIds: [] }),
      expect.objectContaining({ stepId: 'step-2', title: 'Build', dependsOnStepIds: ['step-1'] }),
      expect.objectContaining({ stepId: 'step-3', title: 'QA', dependsOnStepIds: ['step-2'] }),
    ])
    expect(playbookTemplateSteps({ schemaVersion: 1, steps: template.steps })).toEqual(['Discovery', 'Build', 'QA'])
  })

  it('preserves structured execution metadata and validates dependencies', () => {
    const template = normalizeProjectPlaybookTemplate({
      schemaVersion: 1,
      steps: [
        { stepId: 'research', title: 'Research', spec: 'Inspect sources', assigneeAgentId: 'sage', expectedArtifacts: ['research note'] },
        { stepId: 'build', title: 'Build', spec: 'Implement approved scope', assigneeAgentId: 'theo', dependsOnStepIds: ['research'], reviewerAgentId: 'qa-release', requiredCapability: 'engineering', riskLevel: 'high', verifierChecklist: ['Run tests'] },
      ],
    })
    expect(validateProjectPlaybookTemplate(template)).toEqual({ ok: true })
    expect(template.steps[1]).toEqual(expect.objectContaining({
      assigneeAgentId: 'theo', reviewerAgentId: 'qa-release', requiredCapability: 'engineering', expectedArtifacts: [], verifierChecklist: ['Run tests'],
    }))

    expect(validateProjectPlaybookTemplate({ ...template, steps: [{ ...template.steps[0], dependsOnStepIds: ['missing'] }] })).toEqual(expect.objectContaining({ ok: false }))
  })

  it('rejects duplicate step ids and dependency cycles', () => {
    const duplicate = normalizeProjectPlaybookTemplate({ schemaVersion: 1, steps: [{ stepId: 'same', title: 'One', spec: 'One' }, { stepId: 'same', title: 'Two', spec: 'Two' }] })
    expect(validateProjectPlaybookTemplate(duplicate)).toEqual(expect.objectContaining({ ok: false }))

    const cycle = normalizeProjectPlaybookTemplate({ schemaVersion: 1, steps: [{ stepId: 'a', title: 'A', spec: 'A', dependsOnStepIds: ['b'] }, { stepId: 'b', title: 'B', spec: 'B', dependsOnStepIds: ['a'] }] })
    expect(validateProjectPlaybookTemplate(cycle)).toEqual(expect.objectContaining({ ok: false }))
  })
})
