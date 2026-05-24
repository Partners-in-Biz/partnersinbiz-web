jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}))

jest.mock('@/lib/email/send', () => ({
  sendEmail: jest.fn(),
}))

jest.mock('@/lib/organizations/manager-emails', () => ({
  getOrgManagerEmails: jest.fn(),
}))

import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email/send'
import { getOrgManagerEmails } from '@/lib/organizations/manager-emails'
import { notifyNewComment } from '@/lib/notifications/notify'

const mockedAdminDb = adminDb as jest.Mocked<typeof adminDb>
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>
const mockedGetOrgManagerEmails = getOrgManagerEmails as jest.MockedFunction<typeof getOrgManagerEmails>

describe('notifyNewComment', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('links admin or AI comment emails to the commented resource instead of the social portal', async () => {
    mockedAdminDb.collection.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ settings: { notificationEmail: 'client@example.com' } }),
        }),
      }),
    } as any)

    await notifyNewComment({
      commentText: 'Approval check: spec is ready',
      commenterName: 'AI Agent',
      commenterRole: 'ai',
      context: 'task "Peet approval: Organisations Dashboard Mission Control Upgrade Spec"',
      orgId: 'pib-platform-owner',
      viewUrl: '/admin/org/partners/projects/project_123?taskId=task_456',
    })

    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'client@example.com',
      subject: '[PIB] New comment on task "Peet approval: Organisations Dashboard Mission Control Upgrade Spec"',
      html: expect.stringContaining('href="https://partnersinbiz.online/admin/org/partners/projects/project_123?taskId=task_456"'),
    }))
    expect(mockedSendEmail.mock.calls[0][0].html).not.toContain('href="https://partnersinbiz.online/portal/social"')
  })

  it('still links client comment emails to the commented resource for workspace managers', async () => {
    mockedGetOrgManagerEmails.mockResolvedValue(['manager@example.com'])

    await notifyNewComment({
      commentText: 'Can you check this?',
      commenterName: 'Client User',
      commenterRole: 'client',
      context: 'task "Fix homepage bug"',
      orgId: 'org_client',
      viewUrl: '/admin/org/client/projects/project_123?taskId=task_456',
    })

    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'manager@example.com',
      html: expect.stringContaining('href="https://partnersinbiz.online/admin/org/client/projects/project_123?taskId=task_456"'),
    }))
  })
})
