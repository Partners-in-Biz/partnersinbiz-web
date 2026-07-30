import { resolveNotificationDestination } from '@/lib/notifications/resolve-destination'

function mockDb(task?: { projectId?: string | null; deleted?: boolean } | null) {
  const get = jest.fn().mockResolvedValue({
    exists: task != null,
    data: () => task ?? undefined,
  })
  const doc = jest.fn(() => ({ get }))
  const collection = jest.fn(() => ({ doc }))
  return { db: { collection } as any, collection, doc, get }
}

describe('resolveNotificationDestination', () => {
  it('upgrades a legacy list link using the task projectId', async () => {
    const { db } = mockDb({ projectId: 'project-42' })

    await expect(resolveNotificationDestination({
      db,
      notification: {
        type: 'task.assigned',
        link: '/portal/projects?task=task-9',
        data: null,
        orgId: 'org-1',
      },
      surface: 'portal',
    })).resolves.toBe('/portal/projects/project-42?taskId=task-9')
  })

  it('uses structured data without a database lookup', async () => {
    const { db, collection } = mockDb()

    await expect(resolveNotificationDestination({
      db,
      notification: {
        type: 'task.assigned',
        link: '/portal/projects?task=old',
        data: { taskId: 'task-1', projectId: 'project-1' },
      },
      surface: 'portal',
    })).resolves.toBe('/portal/projects/project-1?taskId=task-1')

    expect(collection).not.toHaveBeenCalled()
  })

  it('keeps non-task links unchanged', async () => {
    const { db } = mockDb()

    await expect(resolveNotificationDestination({
      db,
      notification: {
        type: 'invoice.paid',
        link: '/portal/invoicing/inv-1',
        data: null,
      },
      surface: 'portal',
    })).resolves.toBe('/portal/invoicing/inv-1')
  })
})
