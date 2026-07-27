import {
  normalizeProjectPlaybookTemplate,
  playbookTemplateSteps,
  validateProjectPlaybookTemplate,
} from '@/lib/projects/playbooks'

describe('project playbook templates', () => {
  it('keeps legacy string steps readable as explicit human tasks', () => {
    const template = normalizeProjectPlaybookTemplate({ templateSteps: ['Discovery', 'Build', 'QA'] })
    expect(template).toEqual(expect.objectContaining({ schemaVersion: 1 }))
    expect(template.steps).toEqual([
      expect.objectContaining({ stepId: 'step-1', taskKind: 'human', title: 'Discovery', dependsOnStepIds: [] }),
      expect.objectContaining({ stepId: 'step-2', taskKind: 'human', title: 'Build', dependsOnStepIds: ['step-1'] }),
      expect.objectContaining({ stepId: 'step-3', taskKind: 'human', title: 'QA', dependsOnStepIds: ['step-2'] }),
    ])
    expect(playbookTemplateSteps({ schemaVersion: 1, steps: template.steps })).toEqual(['Discovery', 'Build', 'QA'])
  })

  it('preserves complete structured agent execution metadata and validates dependencies', () => {
    const template = normalizeProjectPlaybookTemplate({
      schemaVersion: 1,
      steps: [
        {
          stepId: 'research', title: 'Research', assigneeAgentId: 'sage',
          agentInput: { spec: 'Inspect sources', constraints: ['Use cited evidence'] },
          requiredCapability: 'research', reviewerAgentId: 'qa-release', riskLevel: 'medium',
          expectedArtifacts: ['research note'], verifierChecklist: ['Citations resolve'],
        },
        {
          stepId: 'build', title: 'Build', assigneeAgentId: 'theo', dependsOnStepIds: ['research'],
          agentInput: { spec: 'Implement approved scope' }, reviewerAgentId: 'qa-release',
          requiredCapability: 'engineering', riskLevel: 'high', expectedArtifacts: ['tested change'],
          verifierChecklist: ['Run tests'],
        },
      ],
    })
    expect(validateProjectPlaybookTemplate(template)).toEqual({ ok: true })
    expect(template.steps[1]).toEqual(expect.objectContaining({
      taskKind: 'agent', assigneeAgentId: 'theo', agentInput: { spec: 'Implement approved scope' },
      reviewerAgentId: 'qa-release', requiredCapability: 'engineering', expectedArtifacts: ['tested change'], verifierChecklist: ['Run tests'],
    }))

    expect(validateProjectPlaybookTemplate({ ...template, steps: [{ ...template.steps[0], dependsOnStepIds: ['missing'] }] })).toEqual(expect.objectContaining({ ok: false }))
  })

  it('rejects duplicate step ids and dependency cycles', () => {
    const complete = (stepId: string, dependsOnStepIds: string[] = []) => ({
      stepId, title: stepId, assigneeAgentId: 'theo', agentInput: { spec: stepId },
      dependsOnStepIds, reviewerAgentId: 'qa-release', requiredCapability: 'engineering',
      riskLevel: 'medium', expectedArtifacts: ['artifact'], verifierChecklist: ['verify'],
    })
    const duplicate = normalizeProjectPlaybookTemplate({ schemaVersion: 1, steps: [complete('same'), complete('same')] })
    expect(validateProjectPlaybookTemplate(duplicate)).toEqual(expect.objectContaining({ ok: false }))

    const cycle = normalizeProjectPlaybookTemplate({ schemaVersion: 1, steps: [complete('a', ['b']), complete('b', ['a'])] })
    expect(validateProjectPlaybookTemplate(cycle)).toEqual(expect.objectContaining({ ok: false }))
  })

  it.each([
    ['assigneeAgentId', { assigneeAgentId: undefined }],
    ['agentInput.spec', { agentInput: { spec: '' } }],
    ['requiredCapability', { requiredCapability: undefined }],
    ['reviewerAgentId', { reviewerAgentId: undefined }],
    ['riskLevel', { riskLevel: undefined }],
    ['expectedArtifacts', { expectedArtifacts: [] }],
    ['verifierChecklist', { verifierChecklist: [] }],
  ])('rejects structured agent steps missing %s', (_field, override) => {
    const template = normalizeProjectPlaybookTemplate({
      schemaVersion: 1,
      steps: [{
        stepId: 'build', title: 'Build', assigneeAgentId: 'theo', agentInput: { spec: 'Build it' },
        reviewerAgentId: 'qa-release', requiredCapability: 'engineering', riskLevel: 'high',
        expectedArtifacts: ['tested change'], verifierChecklist: ['Tests pass'], ...override,
      }],
    })
    expect(validateProjectPlaybookTemplate(template)).toEqual(expect.objectContaining({ ok: false }))
  })

  it('validates local approval-gate references and includes them in cycle detection', () => {
    const agent = {
      stepId: 'deploy', title: 'Deploy', assigneeAgentId: 'theo', agentInput: { spec: 'Deploy safely' },
      reviewerAgentId: 'qa-release', requiredCapability: 'deploy', riskLevel: 'critical',
      expectedArtifacts: ['deployment evidence'], verifierChecklist: ['Health check passes'],
      approvalGateStepId: 'approve-deploy',
    }
    const gate = {
      stepId: 'approve-deploy', taskKind: 'approval-gate', title: 'Approve deploy',
      approvalGate: 'production-deploy', riskLevel: 'critical', expectedArtifacts: ['approval evidence'],
      verifierChecklist: ['Confirm release scope'],
    }
    expect(validateProjectPlaybookTemplate(normalizeProjectPlaybookTemplate({ steps: [agent, gate] }))).toEqual({ ok: true })
    expect(validateProjectPlaybookTemplate(normalizeProjectPlaybookTemplate({ steps: [{ ...agent, approvalGateStepId: 'missing' }, gate] }))).toEqual(expect.objectContaining({ ok: false }))
    expect(validateProjectPlaybookTemplate(normalizeProjectPlaybookTemplate({
      steps: [{ ...agent, dependsOnStepIds: ['approve-deploy'] }, { ...gate, dependsOnStepIds: ['deploy'] }],
    }))).toEqual(expect.objectContaining({ ok: false }))
  })
})
