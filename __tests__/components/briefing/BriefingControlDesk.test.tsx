import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BriefingControlDesk } from '@/components/briefing/BriefingControlDesk'

const briefingItem = {
  id: 'task:item-1',
  orgId: 'org-1',
  priority: 'review',
  title: 'Theo completed work - review required',
  summary: 'Result: Updated the homepage.',
  excerpt: 'Updated the homepage and left evidence.',
  timeAgo: '2 minutes ago',
  requiresAction: true,
  source: { type: 'agent-output', id: 'item-1', url: 'https://partnersinbiz.online/admin/projects/project-1?taskId=task-1' },
  actor: { id: 'agent:theo', name: 'Theo', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    projectId: 'project-1',
    projectName: 'Launch site',
    taskId: 'task-1',
    taskTitle: 'Update homepage',
  },
  occurredAt: '2026-05-31T10:00:00.000Z',
}

const documentBriefingItem = {
  id: 'client-document:doc-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Document pending approval: Growth plan',
  summary: 'Type: proposal. Status: published. Approval: pending',
  excerpt: 'Review the proposed growth plan.',
  timeAgo: '5 minutes ago',
  requiresAction: true,
  source: { type: 'client-document', id: 'doc-1', url: '/portal/documents/doc-1' },
  actor: { id: 'user:admin-1', name: 'Peet', role: 'admin', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    documentId: 'doc-1',
    documentTitle: 'Growth plan',
  },
  occurredAt: '2026-05-31T10:00:00.000Z',
}

const documentCommentBriefingItem = {
  id: 'comment:doc-comment-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Client comment from Riley',
  summary: 'Can you clarify the implementation timeline in this proposal?',
  excerpt: 'Can you clarify the implementation timeline in this proposal?',
  timeAgo: '4 minutes ago',
  requiresAction: true,
  source: { type: 'comment', id: 'doc-comment-1', url: '/portal/documents/doc-1' },
  actor: { id: 'user:riley', name: 'Riley', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    documentId: 'doc-1',
    documentTitle: 'Growth plan',
  },
  metadata: {
    parentType: 'document',
    userRole: 'client',
  },
  occurredAt: '2026-05-31T10:01:00.000Z',
}

const approvalBriefingItem = {
  id: 'approval:approval-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Approval pending',
  summary: 'Status: pending. Comments: Please approve the landing page scope before Theo continues.',
  excerpt: 'Please approve the landing page scope before Theo continues.',
  timeAgo: '5 minutes ago',
  requiresAction: true,
  source: { type: 'approval', id: 'approval-1', url: '/portal/projects/project-1?taskId=approval-task-1' },
  actor: { id: 'agent:theo', name: 'Theo', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    projectId: 'project-1',
    projectName: 'Launch site',
    taskId: 'approval-task-1',
    taskTitle: 'Approve landing page scope',
  },
  metadata: {
    approvalStatus: 'pending',
    approvalType: 'scope',
    requestedBy: 'agent:theo',
    approvalTaskId: 'approval-task-1',
  },
  occurredAt: '2026-05-31T10:00:00.000Z',
}

const secondOrgBriefingItem = {
  id: 'task:item-2',
  orgId: 'org-2',
  priority: 'critical',
  title: 'Blocked launch checklist',
  summary: 'The launch checklist is waiting on client access.',
  excerpt: 'DNS access is still missing.',
  timeAgo: '1 minute ago',
  requiresAction: true,
  source: { type: 'task', id: 'task-2', url: '/portal/projects/project-2?taskId=task-2' },
  actor: { id: 'user:client-2', name: 'Client Two', role: 'client', type: 'user' },
  context: {
    orgId: 'org-2',
    orgName: 'Client Two',
    orgSlug: 'client-two',
    projectId: 'project-2',
    projectName: 'Launch checklist',
    taskId: 'task-2',
    taskTitle: 'Provide DNS access',
  },
  occurredAt: '2026-05-31T10:04:00.000Z',
}

const conversationBriefingItem = {
  id: 'comment:conv-comment-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Client comment from Sam',
  summary: 'Can we confirm the launch date today?',
  excerpt: 'Can we confirm the launch date today?',
  timeAgo: '3 minutes ago',
  requiresAction: true,
  source: { type: 'comment', id: 'conv-comment-1', url: '/admin/communications?convId=conv-1' },
  actor: { id: 'user:sam', name: 'Sam', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    conversationId: 'conv-1',
    conversationTitle: 'Launch planning',
  },
  occurredAt: '2026-05-31T10:02:00.000Z',
}

const socialBriefingItem = {
  id: 'social-post:post-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Social post awaiting client approval',
  summary: 'LinkedIn and Facebook post is ready for review.',
  excerpt: 'Launch offer post for approval.',
  timeAgo: '4 minutes ago',
  requiresAction: true,
  source: { type: 'social-post', id: 'post-1', url: '/portal/social/review/post-1' },
  actor: { id: 'agent:maya', name: 'Maya', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
  },
  metadata: {
    actionStage: 'client',
    status: 'client_review',
    platforms: ['linkedin', 'facebook'],
  },
  occurredAt: '2026-05-31T10:01:00.000Z',
}

const notificationBriefingItem = {
  id: 'notification:notification-1',
  orgId: 'org-1',
  priority: 'client-risk',
  title: 'New enquiry needs follow-up',
  summary: 'A new lead requested a proposal call.',
  excerpt: 'A new lead requested a proposal call.',
  timeAgo: '6 minutes ago',
  requiresAction: true,
  source: { type: 'notification', id: 'notification-1', url: '/portal/contacts?followUp=stale' },
  actor: { id: 'system', name: 'System', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
  },
  metadata: {
    notificationType: 'crm.follow_up_due',
    status: 'unread',
    link: '/portal/contacts?followUp=stale',
  },
  occurredAt: '2026-05-31T09:59:00.000Z',
}

const activityBriefingItem = {
  id: 'activity:activity-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Follow up with Ava Owner',
  summary: 'Follow up with Ava about the retainer approval before Friday.',
  excerpt: 'Confirm approval blockers',
  timeAgo: '7 minutes ago',
  requiresAction: true,
  source: { type: 'activity', id: 'activity-1', url: '/portal/contacts/contact-1' },
  actor: { id: 'user:client-1', name: 'Ava Owner', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    contactId: 'contact-1',
    contactName: 'Ava Owner',
    dealId: 'deal-1',
    dealTitle: 'Website retainer',
  },
  metadata: {
    activityType: 'note',
    contactId: 'contact-1',
    dealId: 'deal-1',
    followUpIntent: 'follow_up',
  },
  occurredAt: '2026-05-31T09:58:00.000Z',
}

const reportBriefingItem = {
  id: 'report:report-1',
  orgId: 'org-1',
  priority: 'review',
  title: 'Report ready to review: May performance report',
  summary: 'Monthly report is rendered and ready to send.',
  excerpt: 'Revenue grew after the launch sprint.',
  timeAgo: '8 minutes ago',
  requiresAction: true,
  source: { type: 'report', id: 'report-1', url: '/reports/public-report-token' },
  actor: { id: 'agent:analyst', name: 'Analyst', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    reportId: 'report-1',
    reportTitle: 'May performance report',
  },
  metadata: {
    reportType: 'monthly',
    status: 'rendered',
    publicToken: 'public-report-token',
  },
  occurredAt: '2026-05-31T09:57:00.000Z',
}

const supportBriefingItem = {
  id: 'support-ticket:support-1',
  orgId: 'org-1',
  priority: 'critical',
  title: 'Urgent support: Website form is not sending leads',
  summary: 'The form failed twice and needs a reply.',
  excerpt: 'The form failed twice.',
  timeAgo: '9 minutes ago',
  requiresAction: true,
  source: { type: 'support-ticket', id: 'support-1', url: '/admin/support?ticket=support-1' },
  actor: { id: 'user:client-1', name: 'Riley Client', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    supportTicketId: 'support-1',
    supportTicketSubject: 'Website form is not sending leads',
  },
  metadata: {
    supportStatus: 'waiting_on_us',
    supportPriority: 'urgent',
    sourcePath: '/portal/campaigns',
  },
  occurredAt: '2026-05-31T09:56:00.000Z',
}

const invoiceBriefingItem = {
  id: 'invoice:invoice-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Draft invoice ready: INV-1001',
  summary: 'R12,500.00 invoice for Riley Client is ready to send.',
  excerpt: 'Draft invoice ready for client delivery.',
  timeAgo: '10 minutes ago',
  requiresAction: true,
  source: { type: 'invoice', id: 'invoice-1', url: '/admin/invoicing/invoice-1' },
  actor: { id: 'system', name: 'System', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    invoiceId: 'invoice-1',
    invoiceNumber: 'INV-1001',
  },
  metadata: {
    invoiceStatus: 'draft',
    total: 12500,
    currency: 'ZAR',
    recipientName: 'Riley Client',
  },
  occurredAt: '2026-05-31T09:55:00.000Z',
}

const invoiceProofBriefingItem = {
  id: 'invoice:invoice-proof-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Payment proof needs review: INV-2001',
  summary: 'R8,800.00 invoice for Riley Client. Status: payment_pending_verification.',
  excerpt: 'Paid from FNB.',
  timeAgo: '10 minutes ago',
  requiresAction: true,
  source: { type: 'invoice', id: 'invoice-proof-1', url: '/admin/invoicing/invoice-proof-1' },
  actor: { id: 'system', name: 'Billing', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    invoiceId: 'invoice-proof-1',
    invoiceNumber: 'INV-2001',
  },
  metadata: {
    invoiceStatus: 'payment_pending_verification',
    total: 8800,
    currency: 'ZAR',
    recipientName: 'Riley Client',
    paymentProofFileId: 'file-proof-1',
    paymentProofUploadedAt: '2026-05-31',
  },
  occurredAt: '2026-05-31T09:54:30.000Z',
}

const expenseBriefingItem = {
  id: 'expense:expense-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Expense needs approval: Travel',
  summary: 'R425.50 expense from Bolt. Billable. Reimbursable.',
  excerpt: 'Taxi to workshop.',
  timeAgo: '11 minutes ago',
  requiresAction: true,
  source: { type: 'expense', id: 'expense-1', url: '/admin/finance?expense=expense-1' },
  actor: { id: 'user:client-1', name: 'Riley Client', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    projectId: 'project-1',
    projectName: 'Launch site',
    expenseId: 'expense-1',
    expenseCategory: 'Travel',
  },
  metadata: {
    expenseStatus: 'submitted',
    amount: 425.5,
    currency: 'ZAR',
    vendor: 'Bolt',
    billable: true,
    reimbursable: true,
  },
  occurredAt: '2026-05-31T09:54:00.000Z',
}

const seoContentBriefingItem = {
  id: 'seo-content:seo-content-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'SEO content awaiting review: Website SEO launch checklist',
  summary: 'How-to content for website seo checklist is ready for client review.',
  excerpt: 'Ready for review.',
  timeAgo: '12 minutes ago',
  requiresAction: true,
  source: { type: 'seo-content', id: 'seo-content-1', url: '/admin/seo/sprints/sprint-1/content?content=seo-content-1' },
  actor: { id: 'agent:writer', name: 'Writer', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    seoContentId: 'seo-content-1',
    seoContentTitle: 'Website SEO launch checklist',
    seoSprintId: 'sprint-1',
  },
  metadata: {
    seoStatus: 'review',
    contentType: 'how-to',
    targetKeyword: 'website seo checklist',
    publishDate: '2026-06-05',
  },
  occurredAt: '2026-05-31T09:53:00.000Z',
}

const seoTaskBriefingItem = {
  id: 'seo-task:seo-task-1',
  orgId: 'org-1',
  priority: 'critical',
  title: 'Blocked SEO task: Fix sitemap canonical drift',
  summary: 'Technical SEO task is blocked. Waiting for CMS admin access.',
  excerpt: 'Waiting for CMS admin access.',
  timeAgo: '12 minutes ago',
  requiresAction: true,
  source: { type: 'seo-task', id: 'seo-task-1', url: '/admin/seo/sprints/sprint-1/tasks?task=seo-task-1' },
  actor: { id: 'system', name: 'System', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    seoTaskId: 'seo-task-1',
    seoTaskTitle: 'Fix sitemap canonical drift',
    seoSprintId: 'sprint-1',
  },
  metadata: {
    seoTaskStatus: 'blocked',
    taskType: 'technical',
    focus: 'Technical SEO',
    week: 2,
    phase: 1,
    autopilotEligible: true,
    blockerReason: 'Waiting for CMS admin access',
  },
  occurredAt: '2026-05-31T09:52:30.000Z',
}

const adCampaignBriefingItem = {
  id: 'ad-campaign:ad-campaign-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Ad campaign awaiting approval: June lead generation push',
  summary: 'Meta LEADS campaign is waiting for client approval.',
  excerpt: 'Client must approve before launch.',
  timeAgo: '13 minutes ago',
  requiresAction: true,
  source: { type: 'ad-campaign', id: 'ad-campaign-1', url: '/admin/org/client-one/ads/campaigns/ad-campaign-1' },
  actor: { id: 'admin-1', name: 'Peet', role: 'admin', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    adCampaignId: 'ad-campaign-1',
    adCampaignName: 'June lead generation push',
  },
  metadata: {
    adCampaignStatus: 'PENDING_REVIEW',
    reviewState: 'awaiting',
    platform: 'meta',
    objective: 'LEADS',
    dailyBudget: 25000,
  },
  occurredAt: '2026-05-31T09:52:00.000Z',
}

const formSubmissionBriefingItem = {
  id: 'form-submission:submission-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'New form submission from Ava Owner',
  summary: 'Ava Owner submitted website-contact. Email: ava@example.test.',
  excerpt: 'Please send the pricing deck.',
  timeAgo: '14 minutes ago',
  requiresAction: true,
  source: { type: 'form-submission', id: 'submission-1', url: '/admin/forms/form-1/submissions/submission-1' },
  actor: { id: 'public-form', name: 'Website visitor', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    formId: 'form-1',
    formSubmissionId: 'submission-1',
    contactId: 'contact-1',
    contactName: 'Ava Owner',
  },
  metadata: {
    formSubmissionStatus: 'new',
    formId: 'form-1',
    source: 'website-contact',
    email: 'ava@example.test',
  },
  occurredAt: '2026-05-31T09:51:00.000Z',
}

describe('BriefingControlDesk', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-05-31T10:05:00.000Z'))
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return {
          ok: true,
          json: async () => ({ data: [
            { id: 'org-1', name: 'Client One', slug: 'client-one' },
            { id: 'org-2', name: 'Client Two', slug: 'client-two' },
          ] }),
        } as Response
      }
      if (url.startsWith('/api/v1/briefings/feed')) {
        const items = url.includes('orgId=org-2')
          ? [secondOrgBriefingItem]
          : [briefingItem, documentBriefingItem, documentCommentBriefingItem, approvalBriefingItem, conversationBriefingItem, socialBriefingItem, notificationBriefingItem, activityBriefingItem, reportBriefingItem, supportBriefingItem, invoiceBriefingItem, invoiceProofBriefingItem, expenseBriefingItem, seoContentBriefingItem, seoTaskBriefingItem, adCampaignBriefingItem, formSubmissionBriefingItem, secondOrgBriefingItem]
        return {
          ok: true,
          json: async () => ({ data: { items, total: items.length, hasMore: false, generatedAt: '2026-05-31T10:05:00.000Z' } }),
        } as Response
      }
      if (url === '/api/v1/briefings/items/task%3Aitem-1/state') {
        return {
          ok: true,
          json: async () => ({ data: { itemId: 'task:item-1', status: 'handled' } }),
        } as Response
      }
      if (url === '/api/v1/projects/project-1/tasks/task-1/comments') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'comment-1' } }),
        } as Response
      }
      if (url === '/api/v1/projects/project-1/tasks/approval-task-1') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'approval-task-1' } }),
        } as Response
      }
      if (url === '/api/v1/client-documents/doc-1/comments') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'document-comment-1' } }),
        } as Response
      }
      if (url === '/api/v1/client-documents/doc-1/comments/doc-comment-1/replies') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'document-reply-1' } }),
        } as Response
      }
      if (url === '/api/v1/client-documents/doc-1/comments/doc-comment-1/resolve') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'doc-comment-1', status: 'resolved' } }),
        } as Response
      }
      if (url === '/api/v1/client-documents/doc-1/approve') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'approval-1' } }),
        } as Response
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        return {
          ok: true,
          json: async () => ({ data: { message: { id: 'message-1' } } }),
        } as Response
      }
      if (url === '/api/v1/social/posts/post-1/client-approve') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'post-1', status: 'approved' } }),
        } as Response
      }
      if (url === '/api/v1/social/posts/post-1/client-reject') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'post-1', status: 'regenerating' } }),
        } as Response
      }
      if (url === '/api/v1/notifications/notification-1') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'notification-1' } }),
        } as Response
      }
      if (url === '/api/v1/crm/activities') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'activity-note-1' } }),
        } as Response
      }
      if (url === '/api/v1/reports/report-1/send') {
        return {
          ok: true,
          json: async () => ({ ok: true, link: '/reports/public-report-token', recipients: ['client@example.test'] }),
        } as Response
      }
      if (url === '/api/v1/portal/support/support-1/messages') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'support-message-1' } }),
        } as Response
      }
      if (url === '/api/v1/invoices/invoice-1/send') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'invoice-1', status: 'sent' } }),
        } as Response
      }
      if (url === '/api/v1/invoices/invoice-proof-1/confirm-payment') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'invoice-proof-1', status: 'paid' } }),
        } as Response
      }
      if (url === '/api/v1/expenses/expense-1/approve') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'expense-1', status: 'approved' } }),
        } as Response
      }
      if (url === '/api/v1/seo/content/seo-content-1/client-approve') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'seo-content-1', status: 'client_approved' } }),
        } as Response
      }
      if (url === '/api/v1/seo/content/seo-content-1/comments') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'seo-comment-1', statusFlipped: true } }),
        } as Response
      }
      if (url === '/api/v1/seo/tasks/seo-task-1/execute') {
        return {
          ok: true,
          json: async () => ({ data: { taskId: 'seo-task-1', status: 'started' } }),
        } as Response
      }
      if (url === '/api/v1/seo/tasks/seo-task-1/complete') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'seo-task-1', completed: true } }),
        } as Response
      }
      if (url === '/api/v1/seo/tasks/seo-task-1/skip') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'seo-task-1', skipped: true } }),
        } as Response
      }
      if (url === '/api/v1/portal/ads/campaigns/ad-campaign-1/approve') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'ad-campaign-1', reviewState: 'approved' } }),
        } as Response
      }
      if (url === '/api/v1/portal/ads/campaigns/ad-campaign-1/reject') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'ad-campaign-1', reviewState: 'rejected' } }),
        } as Response
      }
      if (url === '/api/v1/forms/form-1/submissions/submission-1') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'submission-1', status: 'read' } }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ data: { id: 'ok' } }),
      } as Response
    }) as jest.Mock
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('renders a live multi-org control desk with source-aware task actions', async () => {
    render(<BriefingControlDesk mode="portal" />)

    expect(await screen.findByText('Briefings control desk')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /live on/i })).toBeInTheDocument()
    expect((await screen.findAllByText('Theo completed work - review required')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Client One').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /filter to client two workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/projects/project-1?taskId=task-1')
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send back to agent/i })).toBeInTheDocument()
  })

  it('lets users switch the live desk to a noisy organisation from workspace pulse', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /filter to client two workspace/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/briefings/feed?orgId=org-2'))
    })
    expect((await screen.findAllByText('Blocked launch checklist')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Theo completed work - review required')).not.toBeInTheDocument()
    expect(screen.getAllByText('1 live cards').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /all workspaces/i })).toBeInTheDocument()
  })

  it('posts inline replies and removes handled cards from the visible desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    expect((await screen.findAllByText('Theo completed work - review required')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Inline task reply'), { target: { value: 'Approved. Please ship it.' } })
    fireEvent.click(screen.getByRole('button', { name: /post reply to task/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/tasks/task-1/comments', expect.objectContaining({
        method: 'POST',
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /handled/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /handled/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/briefings/items/task%3Aitem-1/state', expect.objectContaining({
        method: 'POST',
      }))
    })
    await waitFor(() => {
      expect(screen.queryAllByText('Theo completed work - review required')).toHaveLength(0)
    })
  })

  it('lets users comment on and approve document approval cards from the desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Document pending approval: Growth plan/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/documents/doc-1')
    expect(screen.getByRole('button', { name: /approve document/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Inline document reply'), { target: { value: 'Please update the scope before approval.' } })
    fireEvent.click(screen.getByRole('button', { name: /post reply to document/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/client-documents/doc-1/comments', expect.objectContaining({
        method: 'POST',
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve document/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /approve document/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/client-documents/doc-1/approve', expect.objectContaining({
        method: 'POST',
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve document/i })).not.toBeDisabled()
    })
  })

  it('replies directly to document comment cards instead of creating a new document comment', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Client comment from Riley/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/documents/doc-1')
    expect(screen.getByText('Growth plan (doc-1)')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Inline document comment reply'), { target: { value: 'We can start implementation next Monday after sign-off.' } })
    fireEvent.click(screen.getByRole('button', { name: /reply to document comment/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/client-documents/doc-1/comments/doc-comment-1/replies', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'We can start implementation next Monday after sign-off.' }),
      }))
    })
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/client-documents/doc-1/comments', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'We can start implementation next Monday after sign-off.' }),
    }))
    await waitFor(() => {
      expect(screen.getByLabelText('Inline document comment reply')).toHaveValue('')
    })
  })

  it('resolves document comment cards against the source document comment', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Client comment from Riley/i }))

    expect(screen.getByRole('button', { name: /resolve document comment/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /resolve document comment/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/client-documents/doc-1/comments/doc-comment-1/resolve', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ resolved: true }),
      }))
    })
  })

  it('lets users approve and reject approval gate cards from the desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Approval pending/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/projects/project-1?taskId=approval-task-1')
    expect(screen.getByRole('button', { name: /approve approval/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject approval/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /approve approval/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/tasks/approval-task-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          reviewStatus: 'approved',
          approvalStatus: 'approved',
          columnId: 'done',
          agentStatus: 'done',
        }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject approval/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /reject approval/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/tasks/approval-task-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          reviewStatus: 'changes-requested',
          approvalStatus: 'rejected',
          agentStatus: 'pending',
          columnId: 'todo',
        }),
      }))
    })
  })

  it('deep-links and replies to conversation comment cards from the desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Client comment from Sam/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/conversations?convId=conv-1')
    expect(screen.getByText('Launch planning (conv-1)')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Inline conversation reply'), { target: { value: 'Yes, launch is confirmed for Friday.' } })
    fireEvent.click(screen.getByRole('button', { name: /post reply to conversation/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Yes, launch is confirmed for Friday.' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Inline conversation reply')).toHaveValue('')
    })
  })

  it('approves and rejects social approval cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Social post awaiting client approval/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/social/review/post-1')
    expect(screen.getByRole('button', { name: /approve social post/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request social changes/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /approve social post/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts/post-1/client-approve', expect.objectContaining({
        method: 'POST',
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve social post/i })).not.toBeDisabled()
    })
    fireEvent.change(screen.getByLabelText('Social change request'), { target: { value: 'Please make the CTA more direct.' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /request social changes/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /request social changes/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/posts/post-1/client-reject', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Please make the CTA more direct.' }),
      }))
    })
  })

  it('marks notification cards read or archived from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /New enquiry needs follow-up/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/contacts?followUp=stale')
    expect(screen.getByRole('button', { name: /mark notification read/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archive notification/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark notification read/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/notifications/notification-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'read' }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /archive notification/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /archive notification/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/notifications/notification-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      }))
    })
  })

  it('logs CRM follow-up notes from activity cards and keeps source links exact', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Follow up with Ava Owner/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/contacts/contact-1')
    expect(screen.getByText('Ava Owner (contact-1)')).toBeInTheDocument()
    expect(screen.getByText('Website retainer (deal-1)')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Follow-up note'), { target: { value: 'Called Ava; approval is waiting on finance.' } })
    fireEvent.click(screen.getByRole('button', { name: /log follow-up note/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/activities', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          contactId: 'contact-1',
          dealId: 'deal-1',
          type: 'note',
          summary: 'Called Ava; approval is waiting on finance.',
          metadata: {
            sourceBriefingId: 'activity:activity-1',
            sourceActivityId: 'activity-1',
            source: 'briefings-control-desk',
          },
        }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Follow-up note')).toHaveValue('')
    })
  })

  it('opens and sends rendered report cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Report ready to review: May performance report/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/reports/public-report-token')
    expect(screen.getByText('May performance report (report-1)')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Report recipients'), { target: { value: 'client@example.test, ops@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: /send report/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/reports/report-1/send', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to: ['client@example.test', 'ops@example.test'] }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Report recipients')).toHaveValue('')
    })
  })

  it('replies to support ticket cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Urgent support: Website form is not sending leads/i }))

    expect(screen.getByText('Website form is not sending leads (support-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal')

    fireEvent.change(screen.getByLabelText('Support reply'), { target: { value: 'We are checking the form submissions and will update you shortly.' } })
    fireEvent.click(screen.getByRole('button', { name: /reply to support ticket/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/support/support-1/messages', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ body: 'We are checking the form submissions and will update you shortly.' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Support reply')).toHaveValue('')
    })
  })

  it('opens and sends draft invoice cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Draft invoice ready: INV-1001/i }))

    expect(screen.getByText('INV-1001 (invoice-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/payments?invoice=invoice-1')
    expect(screen.getByRole('button', { name: /send invoice/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /send invoice/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/invoices/invoice-1/send', expect.objectContaining({
        method: 'POST',
      }))
    })
  })

  it('confirms and rejects payment-proof invoice cards from the admin control desk', async () => {
    render(<BriefingControlDesk mode="admin" />)

    fireEvent.click(await screen.findByRole('button', { name: /Payment proof needs review: INV-2001/i }))

    expect(screen.getByText('INV-2001 (invoice-proof-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/admin/invoicing/invoice-proof-1')
    expect(screen.getByRole('button', { name: /confirm payment proof/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject payment proof/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'eft' } })
    fireEvent.change(screen.getByLabelText('Payment reference'), { target: { value: 'FNB-12345' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm payment proof/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/invoices/invoice-proof-1/confirm-payment', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ confirmed: true, paymentMethod: 'eft', reference: 'FNB-12345' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm payment proof/i })).not.toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('Payment proof rejection reason'), { target: { value: 'Proof does not match the invoice total.' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject payment proof/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /reject payment proof/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/invoices/invoice-proof-1/confirm-payment', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ confirmed: false, reason: 'Proof does not match the invoice total.' }),
      }))
    })
  })

  it('approves and rejects submitted expense cards from the admin control desk', async () => {
    render(<BriefingControlDesk mode="admin" />)

    fireEvent.click(await screen.findByRole('button', { name: /Expense needs approval: Travel/i }))

    expect(screen.getByText('Travel (expense-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/admin/finance?expense=expense-1')
    expect(screen.getByRole('button', { name: /approve expense/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject expense/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /approve expense/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/expenses/expense-1/approve', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'approve' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve expense/i })).not.toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('Expense rejection note'), { target: { value: 'Receipt does not match the workshop date.' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject expense/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /reject expense/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/expenses/expense-1/approve', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'reject', note: 'Receipt does not match the workshop date.' }),
      }))
    })
  })

  it('approves SEO content and requests content changes from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /SEO content awaiting review: Website SEO launch checklist/i }))

    expect(screen.getByText('Website SEO launch checklist (seo-content-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/seo/sprints/sprint-1/content?content=seo-content-1')
    expect(screen.getByRole('button', { name: /approve SEO content/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request SEO changes/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /approve SEO content/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/seo/content/seo-content-1/client-approve', expect.objectContaining({
        method: 'POST',
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve SEO content/i })).not.toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('SEO change request'), { target: { value: 'Please add a local pricing example before publishing.' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /request SEO changes/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /request SEO changes/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/seo/content/seo-content-1/comments', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'Please add a local pricing example before publishing.' }),
      }))
    })
  })

  it('executes, completes, and skips SEO task cards from the admin control desk', async () => {
    render(<BriefingControlDesk mode="admin" />)

    fireEvent.click(await screen.findByRole('button', { name: /Blocked SEO task: Fix sitemap canonical drift/i }))

    expect(screen.getByText('Fix sitemap canonical drift (seo-task-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/admin/seo/sprints/sprint-1/tasks?task=seo-task-1')
    expect(screen.getByRole('button', { name: /execute SEO task/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /complete SEO task/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /skip SEO task/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /execute SEO task/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/seo/tasks/seo-task-1/execute', expect.objectContaining({
        method: 'POST',
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /execute SEO task/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /complete SEO task/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/seo/tasks/seo-task-1/complete', expect.objectContaining({
        method: 'POST',
      }))
    })

    fireEvent.change(screen.getByLabelText('SEO task skip reason'), { target: { value: 'CMS access is no longer available this sprint.' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /skip SEO task/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /skip SEO task/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/seo/tasks/seo-task-1/skip', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'CMS access is no longer available this sprint.' }),
      }))
    })
  })

  it('approves and rejects ad campaign review cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Ad campaign awaiting approval: June lead generation push/i }))

    expect(screen.getByText('June lead generation push (ad-campaign-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/ads/campaigns/ad-campaign-1')
    expect(screen.getByRole('button', { name: /approve ad campaign/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request ad campaign changes/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /approve ad campaign/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/ads/campaigns/ad-campaign-1/approve', expect.objectContaining({
        method: 'POST',
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve ad campaign/i })).not.toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('Ad campaign change request'), { target: { value: 'Please reduce the daily budget before launch.' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /request ad campaign changes/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /request ad campaign changes/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/ads/campaigns/ad-campaign-1/reject', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Please reduce the daily budget before launch.' }),
      }))
    })
  })

  it('marks new form submissions read or archived from the admin control desk', async () => {
    render(<BriefingControlDesk mode="admin" />)

    fireEvent.click(await screen.findByRole('button', { name: /New form submission from Ava Owner/i }))

    expect(screen.getByText('Ava Owner (contact-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/admin/forms/form-1/submissions/submission-1')
    expect(screen.getByRole('button', { name: /mark submission read/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archive submission/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark submission read/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/forms/form-1/submissions/submission-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'read' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /archive submission/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /archive submission/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/forms/form-1/submissions/submission-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      }))
    })
  })
})
