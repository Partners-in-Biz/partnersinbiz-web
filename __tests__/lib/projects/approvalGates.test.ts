import { buildApprovalGatedTaskGroup } from '@/lib/projects/approvalGates'

describe('approval-gated task fanout', () => {
  it('creates one approval task and dependent specialist tasks that are held until approval', () => {
    const group = buildApprovalGatedTaskGroup({
      orgId: 'org-1',
      projectId: 'project-1',
      requestedByAgentId: 'pip',
      sourceDocumentId: 'doc-1',
      sourceSpecVersion: 'v2',
      approval: {
        title: 'Approve production release',
        description: 'Peet must approve before release work starts.',
        approverId: 'peet',
      },
      tasks: [
        {
          title: 'Theo: implement release change',
          assigneeAgentId: 'theo',
          reviewerAgentId: 'qa-release',
          requiredCapability: 'deploy',
          riskLevel: 'critical',
          expectedArtifacts: ['pull_request', 'test_report'],
          spec: 'Implement only the approved change.',
        },
      ],
    })

    expect(group.approvalTask).toEqual(expect.objectContaining({
      assigneeAgentId: 'pip',
      agentStatus: 'awaiting-input',
      requiresApproval: true,
      approvalStatus: 'pending',
      requestedByAgentId: 'pip',
      sourceDocumentId: 'doc-1',
      sourceSpecVersion: 'v2',
    }))
    expect(group.specialistTasks).toHaveLength(1)
    expect(group.specialistTasks[0]).toEqual(expect.objectContaining({
      assigneeAgentId: 'theo',
      reviewerAgentId: 'qa-release',
      agentStatus: 'awaiting-input',
      requiredCapability: 'deploy',
      riskLevel: 'critical',
      approvalGateTaskId: group.approvalTask.id,
      dependsOn: [group.approvalTask.id],
    }))
    expect(group.specialistTasks[0].agentInput).toEqual(expect.objectContaining({
      context: expect.objectContaining({
        approvalGateTaskId: group.approvalTask.id,
        sourceDocumentId: 'doc-1',
        sourceSpecVersion: 'v2',
        expectedArtifacts: ['pull_request', 'test_report'],
      }),
    }))
  })
})
