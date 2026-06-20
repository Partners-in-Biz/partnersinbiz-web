import { buildProjectTaskCreateData, buildProjectTaskUpdateData } from '@/lib/projects/taskPayload'

describe('project task review operating model payloads', () => {
  it('stores reviewer delegation, approval gate, expected artifacts, risk, and verifier checklist on agent task creation', () => {
    const result = buildProjectTaskCreateData({
      title: 'Ship reviewed code',
      orgId: 'pib-platform-owner',
      assigneeAgentId: 'theo',
      reviewerAgentId: 'qa-release',
      requiredCapability: 'platform-engineering',
      riskLevel: 'high',
      approvalGate: 'production-deploy',
      expectedArtifacts: ['commit on origin/development', 'typecheck output'],
      verifierChecklist: ['Inspect diff against spec', 'Confirm no production deploy occurred'],
      agentInput: {
        spec: 'Implement the safe development branch slice.',
        context: {
          sourceDocumentId: 'spec-1',
          approvalGate: 'production-deploy',
          verifierChecklist: ['Run tests', 'Check gates'],
        },
      },
    }, 'project-1', 'pib-platform-owner')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value).toMatchObject({
      assigneeAgentId: 'theo',
      reviewerAgentId: 'qa-release',
      requiredCapability: 'platform-engineering',
      riskLevel: 'high',
      approvalGate: 'production-deploy',
      expectedArtifacts: ['commit on origin/development', 'typecheck output'],
      verifierChecklist: ['Inspect diff against spec', 'Confirm no production deploy occurred'],
    })
    expect(result.value.agentInput).toMatchObject({
      context: expect.objectContaining({
        sourceDocumentId: 'spec-1',
        approvalGate: 'production-deploy',
        verifierChecklist: ['Run tests', 'Check gates'],
      }),
    })
  })

  it('lets updates keep review state separate from business approval state', () => {
    const result = buildProjectTaskUpdateData({
      reviewStatus: 'approved',
      approvalStatus: 'pending',
      approvalGate: 'client-visible',
      verifierChecklist: ['Reviewed evidence packet'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value).toEqual(expect.objectContaining({
      reviewStatus: 'approved',
      approvalStatus: 'pending',
      approvalGate: 'client-visible',
      verifierChecklist: ['Reviewed evidence packet'],
    }))
  })
})
