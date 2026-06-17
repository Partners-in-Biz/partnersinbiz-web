jest.mock('firebase-admin/firestore', () => ({
  Timestamp: class MockTimestamp {},
}))

import { notificationAdapter } from '@/lib/briefing/adapters/notificationAdapter'

describe('notificationAdapter', () => {
  it('keeps completed client document approvals readable and out of action risk lanes', () => {
    const item = notificationAdapter.toItem({
      id: 'notification-1',
      orgId: 'pib-platform-owner',
      userId: 'admin-1',
      type: 'client_document.approved',
      title: 'Document approved',
      body: 'nSrWbuR5LHet12NIO6accWPm8e73 approved Admin Reporting Teleprompter — v1 Product Spec.',
      link: '/admin/documents/doc-1',
      status: 'unread',
      priority: 'high',
      data: {
        documentId: 'doc-1',
        documentTitle: 'Admin Reporting Teleprompter — v1 Product Spec',
        actorName: 'nSrWbuR5LHet12NIO6accWPm8e73',
      },
      createdAt: '2026-06-05T17:28:00.000Z',
    }, 'notification-1')

    expect(item).toMatchObject({
      priority: 'fyi',
      source: { type: 'notification', id: 'notification-1', url: '/admin/documents/doc-1' },
      title: 'Document approved',
      summary: 'Admin Reporting Teleprompter — v1 Product Spec was approved.',
      context: { documentId: 'doc-1', documentTitle: 'Admin Reporting Teleprompter — v1 Product Spec' },
      actor: { name: 'System' },
    })
    expect(item.summary).not.toContain('/admin/documents/doc-1')
    expect(item.summary).not.toContain('nSrWbuR5LHet12NIO6accWPm8e73')
  })

  it('does not keep read client notifications in the risk lane', () => {
    const item = notificationAdapter.toItem({
      id: 'notification-2',
      orgId: 'org-client',
      userId: 'admin-1',
      type: 'client_project.updated',
      title: 'Client project updated',
      status: 'read',
      priority: 'normal',
      createdAt: '2026-06-05T17:28:00.000Z',
    }, 'notification-2')

    expect(item.priority).toBe('fyi')
  })

  it('turns stalled agent-task notifications into Needs Peet briefing/inbox items with exact blocker metadata', () => {
    const item = notificationAdapter.toItem({
      id: 'notification-3',
      orgId: 'pib-platform-owner',
      userId: 'peet',
      agentId: 'theo',
      type: 'task.agent_needs_input',
      title: 'Theo needs Peet to continue',
      body: 'Exact blocker: release approval is missing. Proof needed: approval comment. Message for agent: continue after approval.',
      link: '/admin/org/partners-in-biz/projects/project-1?task=task-1',
      status: 'unread',
      priority: 'normal',
      data: {
        projectId: 'project-1',
        taskId: 'task-1',
        blockerReason: 'release approval is missing',
        safeContinuePath: 'Approve in task drawer after evidence is attached.',
      },
      createdAt: '2026-06-05T17:28:00.000Z',
    }, 'notification-3')

    expect(item).toMatchObject({
      priority: 'needs-peet',
      title: 'Needs Peet: Theo needs Peet to continue',
      summary: expect.stringContaining('release approval is missing'),
      metadata: expect.objectContaining({
        blockerReason: 'release approval is missing',
        safeContinuePath: 'Approve in task drawer after evidence is attached.',
      }),
      context: expect.objectContaining({ projectId: 'project-1', taskId: 'task-1' }),
    })
  })
})
