import {
  buildProjectTaskReadModel,
  projectTaskReadModelTask,
} from '@/lib/projects/taskReadModel'

describe('project task read model', () => {
  it('keeps only the fields needed by boards, chat progress, and access filtering', () => {
    const task = projectTaskReadModelTask('task-1', {
      title: 'Ship the mobile build',
      columnId: 'review',
      order: 7,
      agentStatus: 'done',
      internalOnly: false,
      allowedUserIds: ['client-1'],
      dependsOn: ['task-0'],
      agentOutput: {
        summary: 'This deliberately large execution narrative must not be sent on every project poll.',
        artifacts: [{ label: 'Preview', url: 'https://example.test/preview' }],
      },
      description: 'Very large task specification',
      agentInput: { prompt: 'Very large agent prompt' },
      completionEvidence: { secret: 'Do not repeat this in a board or chat poll' },
    })

    expect(task).toEqual({
      id: 'task-1',
      title: 'Ship the mobile build',
      columnId: 'review',
      order: 7,
      agentStatus: 'done',
      internalOnly: false,
      allowedUserIds: ['client-1'],
      dependsOn: ['task-0'],
      agentOutput: {
        artifacts: [{ label: 'Preview', url: 'https://example.test/preview' }],
      },
    })
  })

  it('creates a versioned, order-stable model without task bodies', () => {
    const model = buildProjectTaskReadModel([
      { id: 'later', title: 'Later', order: 20, description: 'large body' },
      { id: 'first', title: 'First', order: 10, agentInput: { prompt: 'large body' } },
    ])

    expect(model).toEqual({
      schemaVersion: 1,
      tasks: [
        { id: 'first', title: 'First', order: 10 },
        { id: 'later', title: 'Later', order: 20 },
      ],
    })
  })
})
