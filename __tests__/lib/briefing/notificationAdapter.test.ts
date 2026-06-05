jest.mock('firebase-admin/firestore', () => ({
  Timestamp: class MockTimestamp {},
}))

import { notificationAdapter } from '@/lib/briefing/adapters/notificationAdapter'

describe('notificationAdapter', () => {
  it('keeps completed client document approvals out of action risk lanes', () => {
    const item = notificationAdapter.toItem({
      id: 'notification-1',
      orgId: 'pib-platform-owner',
      userId: 'admin-1',
      type: 'client_document.approved',
      title: 'Document approved',
      body: 'Admin Reporting Teleprompter — v1 Product Spec was approved.',
      link: '/admin/documents/doc-1',
      status: 'unread',
      priority: 'high',
      createdAt: '2026-06-05T17:28:00.000Z',
    }, 'notification-1')

    expect(item).toMatchObject({
      priority: 'fyi',
      source: { type: 'notification', id: 'notification-1', url: '/admin/documents/doc-1' },
      title: 'Document approved',
    })
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
})
