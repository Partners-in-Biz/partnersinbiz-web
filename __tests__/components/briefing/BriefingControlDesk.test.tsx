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

const contactBriefingItem = {
  id: 'contact:contact-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Follow up Ava Owner',
  summary: 'Ava Owner has not been contacted since 2026-04-01. Stage: proposal.',
  excerpt: 'Last contacted 2026-04-01.',
  timeAgo: '1 day ago',
  requiresAction: true,
  source: { type: 'contact', id: 'contact-1', url: '/portal/contacts/contact-1' },
  actor: { id: 'crm:contact-1', name: 'Ava Owner', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    contactId: 'contact-1',
    contactName: 'Ava Owner',
  },
  metadata: {
    contactStage: 'proposal',
    contactType: 'prospect',
    lastContactedAt: '2026-04-01T08:00:00.000Z',
    company: 'Acme Holdings',
    email: 'ava@example.test',
  },
  occurredAt: '2026-05-30T08:00:00.000Z',
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

const quoteBriefingItem = {
  id: 'quote:quote-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Quote awaiting decision: QUO-1001',
  summary: 'R18,500.00 quote for Riley Client. Status: sent.',
  excerpt: 'Approve this retainer quote before onboarding can continue.',
  timeAgo: '11 minutes ago',
  requiresAction: true,
  source: { type: 'quote', id: 'quote-1', url: '/admin/quotes/quote-1' },
  actor: { id: 'system', name: 'Sales', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    quoteId: 'quote-1',
    quoteNumber: 'QUO-1001',
  },
  metadata: {
    quoteStatus: 'sent',
    total: 18500,
    currency: 'ZAR',
    recipientName: 'Riley Client',
    recipientOrgId: 'org-1',
    sourceOrgId: 'pib-platform-owner',
  },
  occurredAt: '2026-05-31T09:54:00.000Z',
}

const shipmentBriefingItem = {
  id: 'shipment:shipment-1',
  orgId: 'org-1',
  priority: 'review',
  title: 'Shipment in transit: DHL-123',
  summary: 'DHL shipment DHL-123 is in transit to Client warehouse.',
  excerpt: 'Confirm delivery before closing the onboarding order.',
  timeAgo: '12 minutes ago',
  requiresAction: true,
  source: { type: 'shipment', id: 'shipment-1', url: '/portal/companies/company-1?shipment=shipment-1' },
  actor: { id: 'system', name: 'Fulfillment', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    companyId: 'company-1',
    orderId: 'order-1',
    shipmentId: 'shipment-1',
    shipmentTrackingNumber: 'DHL-123',
  },
  metadata: {
    shipmentStatus: 'in_transit',
    carrier: 'DHL',
    trackingNumber: 'DHL-123',
    trackingUrl: 'https://tracking.example.test/DHL-123',
    expectedDeliveryDate: '2026-06-02',
  },
  occurredAt: '2026-05-31T09:53:00.000Z',
}

const orderBriefingItem = {
  id: 'order:order-1',
  orgId: 'org-1',
  priority: 'critical',
  title: 'Order blocked: Website onboarding order',
  summary: 'R18,500.00 order is blocked before delivery.',
  excerpt: 'Waiting on final asset handoff before fulfillment can continue.',
  timeAgo: '12 minutes ago',
  requiresAction: true,
  source: { type: 'order', id: 'order-1', url: '/portal/companies/company-1?order=order-1' },
  actor: { id: 'system', name: 'Fulfillment', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    companyId: 'company-1',
    projectId: 'project-1',
    quoteId: 'quote-1',
    invoiceId: 'invoice-1',
    orderId: 'order-1',
    orderTitle: 'Website onboarding order',
  },
  metadata: {
    orderStatus: 'confirmed',
    fulfillmentStatus: 'blocked',
    total: 18500,
    currency: 'ZAR',
    expectedDeliveryDate: '2026-06-05',
  },
  occurredAt: '2026-05-31T09:52:45.000Z',
}

const inventoryBriefingItem = {
  id: 'inventory-item:stock-1',
  orgId: 'org-1',
  priority: 'client-risk',
  title: 'Low stock: SEO implementation hours',
  summary: 'SEO-HOURS has 2 hours available. Threshold: 5.',
  excerpt: 'Restock delivery capacity before next onboarding sprint.',
  timeAgo: '12 minutes ago',
  requiresAction: true,
  source: { type: 'inventory-item', id: 'stock-1', url: '/portal/companies/company-1?inventory=stock-1' },
  actor: { id: 'system', name: 'Inventory', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    companyId: 'company-1',
    projectId: 'project-1',
    inventoryItemId: 'stock-1',
    inventoryItemName: 'SEO implementation hours',
  },
  metadata: {
    inventoryStatus: 'low_stock',
    quantityAvailable: 2,
    quantityReserved: 1,
    lowStockThreshold: 5,
    unit: 'hours',
    sku: 'SEO-HOURS',
    location: 'Delivery pool',
  },
  occurredAt: '2026-05-31T09:52:30.000Z',
}

const enquiryBriefingItem = {
  id: 'enquiry:enquiry-1',
  orgId: 'pib-platform-owner',
  priority: 'needs-peet',
  title: 'New enquiry from Ava Owner',
  summary: 'marketing enquiry from Ava Owner at Acme Holdings. Email: ava@example.test.',
  excerpt: 'Can we book a proposal call?',
  timeAgo: '13 minutes ago',
  requiresAction: true,
  source: { type: 'enquiry', id: 'enquiry-1', url: '/admin/briefings?source=enquiry&id=enquiry-1' },
  actor: { id: 'public-enquiry', name: 'Ava Owner', role: 'client', type: 'user' },
  context: {
    orgId: 'pib-platform-owner',
    orgName: 'Partners in Biz',
    orgSlug: 'partners-in-biz',
    enquiryId: 'enquiry-1',
    enquiryName: 'Ava Owner',
  },
  metadata: {
    enquiryStatus: 'new',
    email: 'ava@example.test',
    company: 'Acme Holdings',
    projectType: 'marketing',
  },
  occurredAt: '2026-05-31T09:52:15.000Z',
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

const draftBroadcastBriefingItem = {
  id: 'broadcast:broadcast-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Broadcast ready to send: June newsletter',
  summary: 'email broadcast is draft for 24 recipients.',
  excerpt: 'June newsletter launch.',
  timeAgo: '13 minutes ago',
  requiresAction: true,
  source: { type: 'broadcast', id: 'broadcast-1', url: '/portal/campaigns/broadcast/broadcast-1' },
  actor: { id: 'system:broadcast', name: 'Campaign system', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    broadcastId: 'broadcast-1',
    broadcastName: 'June newsletter',
  },
  metadata: {
    broadcastStatus: 'draft',
    channel: 'email',
    subject: 'June growth update',
    audienceSize: 24,
    segmentId: 'segment-1',
  },
  occurredAt: '2026-05-31T09:51:45.000Z',
}

const scheduledBroadcastBriefingItem = {
  id: 'broadcast:broadcast-2',
  orgId: 'org-1',
  priority: 'review',
  title: 'Broadcast scheduled: Product webinar invite',
  summary: 'email broadcast is scheduled for 42 recipients.',
  excerpt: 'Webinar invitation is ready.',
  timeAgo: '13 minutes ago',
  requiresAction: true,
  source: { type: 'broadcast', id: 'broadcast-2', url: '/portal/campaigns/broadcast/broadcast-2' },
  actor: { id: 'system:broadcast', name: 'Campaign system', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    broadcastId: 'broadcast-2',
    broadcastName: 'Product webinar invite',
  },
  metadata: {
    broadcastStatus: 'scheduled',
    channel: 'email',
    subject: 'Join the product webinar',
    audienceSize: 42,
    scheduledFor: '2026-06-01T08:00:00.000Z',
  },
  occurredAt: '2026-05-31T09:51:30.000Z',
}

const pausedBroadcastBriefingItem = {
  id: 'broadcast:broadcast-3',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Broadcast paused: Renewal reminder',
  summary: 'email broadcast is paused for 18 recipients.',
  excerpt: 'Renewal sequence paused before send.',
  timeAgo: '13 minutes ago',
  requiresAction: true,
  source: { type: 'broadcast', id: 'broadcast-3', url: '/portal/campaigns/broadcast/broadcast-3' },
  actor: { id: 'system:broadcast', name: 'Campaign system', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    broadcastId: 'broadcast-3',
    broadcastName: 'Renewal reminder',
  },
  metadata: {
    broadcastStatus: 'paused',
    channel: 'email',
    subject: 'Your renewal is coming up',
    audienceSize: 18,
  },
  occurredAt: '2026-05-31T09:51:15.000Z',
}

const draftCampaignBriefingItem = {
  id: 'campaign:campaign-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Campaign ready to launch: Lead nurture launch',
  summary: 'Campaign is draft and ready for 24 contacts.',
  excerpt: 'Sequence launch needs review.',
  timeAgo: '13 minutes ago',
  requiresAction: true,
  source: { type: 'campaign', id: 'campaign-1', url: '/portal/campaigns/campaign-1' },
  actor: { id: 'system:campaign', name: 'Campaign system', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    campaignId: 'campaign-1',
    campaignName: 'Lead nurture launch',
  },
  metadata: {
    campaignStatus: 'draft',
    segmentId: 'segment-1',
    sequenceId: 'sequence-1',
    contactCount: 24,
  },
  occurredAt: '2026-05-31T09:51:00.000Z',
}

const activeCampaignBriefingItem = {
  id: 'campaign:campaign-2',
  orgId: 'org-1',
  priority: 'progress',
  title: 'Campaign active: Retention nurture',
  summary: 'Campaign is active with 120 enrolled.',
  excerpt: 'Retention campaign is running.',
  timeAgo: '13 minutes ago',
  requiresAction: true,
  source: { type: 'campaign', id: 'campaign-2', url: '/portal/campaigns/campaign-2' },
  actor: { id: 'system:campaign', name: 'Campaign system', role: 'system', type: 'system' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    campaignId: 'campaign-2',
    campaignName: 'Retention nurture',
  },
  metadata: {
    campaignStatus: 'active',
    sequenceId: 'sequence-2',
    enrolled: 120,
  },
  occurredAt: '2026-05-31T09:50:45.000Z',
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

const socialInboxBriefingItem = {
  id: 'social-inbox:social-inbox-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Social DM needs reply from Mia Prospect',
  summary: 'Mia Prospect sent an instagram DM that needs a response.',
  excerpt: 'Can someone reply about the launch package?',
  timeAgo: '15 minutes ago',
  requiresAction: true,
  source: { type: 'social-inbox', id: 'social-inbox-1', url: '/admin/social/inbox?item=social-inbox-1' },
  actor: { id: 'social:mia_prospect', name: 'Mia Prospect', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    socialInboxId: 'social-inbox-1',
    socialInboxFrom: 'Mia Prospect',
    socialPostId: 'post-1',
  },
  metadata: {
    socialInboxStatus: 'unread',
    platform: 'instagram',
    engagementType: 'dm',
    priority: 'high',
    sentiment: 'negative',
    platformUrl: 'https://instagram.example/messages/ig-dm-1',
  },
  occurredAt: '2026-05-31T09:50:00.000Z',
}

const mailboxBriefingItem = {
  id: 'mailbox-message:mailbox-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Unread email from Client Lead',
  summary: 'Client Lead emailed about Can we book a call?.',
  excerpt: 'Please reply with available times.',
  timeAgo: '16 minutes ago',
  requiresAction: true,
  source: { type: 'mailbox-message', id: 'mailbox-1', url: '/portal/email?message=mailbox-1' },
  actor: { id: 'email:lead@example.test', name: 'Client Lead', role: 'client', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    mailboxMessageId: 'mailbox-1',
    mailboxFrom: 'Client Lead',
    mailboxSubject: 'Can we book a call?',
  },
  metadata: {
    mailboxFolder: 'inbox',
    mailboxStatus: 'received',
    mailboxRead: false,
    accountId: 'account-1',
    accountEmail: 'owner@client.test',
    fromEmail: 'lead@example.test',
    subject: 'Can we book a call?',
    threadId: 'gmail-thread-1',
  },
  occurredAt: '2026-05-31T09:49:00.000Z',
}

const agentRunBriefingItem = {
  id: 'agent-run:run-doc-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Theo paused for approval',
  summary: 'Theo is waiting for approval to run shell.exec.',
  excerpt: 'Needs to inspect deployment logs.',
  timeAgo: '12 minutes ago',
  requiresAction: true,
  source: { type: 'agent-run', id: 'run-doc-1', url: '/admin/agents/theo?run=run-live-1' },
  actor: { id: 'agent:theo', name: 'Theo', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    agentRunId: 'run-live-1',
    agentProfile: 'theo-main',
  },
  metadata: {
    agentId: 'theo',
    runStatus: 'waiting_for_approval',
    hermesRunId: 'run-live-1',
    approvalToolName: 'shell.exec',
    approvalReason: 'Needs to inspect deployment logs',
  },
  occurredAt: '2026-05-31T09:48:00.000Z',
}

const workspaceBrokerBriefingItem = {
  id: 'workspace-broker-job:broker-job-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'Workspace share request needs approval: Client-facing plan',
  summary: 'Theo requested a client-visible Google Workspace share.',
  excerpt: 'Share with client.',
  timeAgo: '10 minutes ago',
  requiresAction: true,
  source: { type: 'workspace-broker-job', id: 'broker-job-1', url: '/admin/knowledge/workspace-broker/jobs/broker-job-1' },
  actor: { id: 'agent:theo', name: 'Theo', role: 'ai', type: 'agent' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    workspaceBrokerJobId: 'broker-job-1',
    workspaceBrokerOperation: 'request_share',
    workspaceArtifactId: 'artifact-1',
    workspaceArtifactTitle: 'Client-facing plan',
  },
  metadata: {
    brokerStatus: 'awaiting_approval',
    riskLevel: 'high',
    requiredCapability: 'publish',
    googleMutationPerformed: false,
  },
  occurredAt: '2026-05-31T09:47:00.000Z',
}

const calendarBriefingItem = {
  id: 'calendar-event:event-1',
  orgId: 'org-1',
  priority: 'needs-peet',
  title: 'RSVP needed: Website retainer check-in',
  summary: 'Starts 2026-06-01 10:00. RSVP is still pending.',
  excerpt: 'Confirm launch blockers.',
  timeAgo: '8 minutes ago',
  requiresAction: true,
  source: { type: 'calendar-event', id: 'event-1', url: '/portal/contacts/contact-1?event=event-1' },
  actor: { id: 'user:admin-1', name: 'Peet', role: 'admin', type: 'user' },
  context: {
    orgId: 'org-1',
    orgName: 'Client One',
    orgSlug: 'client-one',
    calendarEventId: 'event-1',
    calendarEventTitle: 'Website retainer check-in',
    contactId: 'contact-1',
    contactName: 'Ava Owner',
  },
  metadata: {
    rsvpStatus: 'pending',
    attendeeEmail: 'ava@example.test',
    startAt: '2026-06-01T08:00:00.000Z',
    endAt: '2026-06-01T08:30:00.000Z',
    timezone: 'Africa/Johannesburg',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
  },
  occurredAt: '2026-05-31T09:46:00.000Z',
}

const bookingBriefingItem = {
  id: 'booking:booking-1',
  orgId: 'pib-platform-owner',
  priority: 'critical',
  title: 'Booking needs Meet link: Mia Founder',
  summary: '20-minute call with Mia Founder on 2026-06-01 at 10:30 SAST.',
  excerpt: 'Need a growth app plan.',
  timeAgo: '7 minutes ago',
  requiresAction: true,
  source: { type: 'booking', id: 'booking-1', url: '/admin/briefings?source=booking&id=booking-1' },
  actor: { id: 'booking:mia@example.test', name: 'Mia Founder', role: 'client', type: 'user' },
  context: {
    orgId: 'pib-platform-owner',
    orgName: 'Partners in Biz',
    orgSlug: 'partners-in-biz',
    bookingId: 'booking-1',
    bookingName: 'Mia Founder',
  },
  metadata: {
    bookingStatus: 'confirmed',
    email: 'mia@example.test',
    company: 'Mia Studio',
    date: '2026-06-01',
    time: '10:30',
    timezone: 'Africa/Johannesburg',
    durationMins: 20,
    meetLink: null,
    googleEventId: null,
  },
  occurredAt: '2026-05-31T09:45:00.000Z',
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
          : [briefingItem, documentBriefingItem, documentCommentBriefingItem, approvalBriefingItem, conversationBriefingItem, socialBriefingItem, notificationBriefingItem, activityBriefingItem, contactBriefingItem, reportBriefingItem, supportBriefingItem, invoiceBriefingItem, invoiceProofBriefingItem, quoteBriefingItem, shipmentBriefingItem, orderBriefingItem, inventoryBriefingItem, enquiryBriefingItem, bookingBriefingItem, expenseBriefingItem, seoContentBriefingItem, seoTaskBriefingItem, adCampaignBriefingItem, draftBroadcastBriefingItem, scheduledBroadcastBriefingItem, pausedBroadcastBriefingItem, draftCampaignBriefingItem, activeCampaignBriefingItem, formSubmissionBriefingItem, socialInboxBriefingItem, mailboxBriefingItem, agentRunBriefingItem, workspaceBrokerBriefingItem, calendarBriefingItem, secondOrgBriefingItem]
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
      if (url === '/api/v1/crm/contacts/contact-1') {
        return {
          ok: true,
          json: async () => ({ data: { contact: { id: 'contact-1', lastContactedAt: '2026-05-31T10:05:00.000Z' } } }),
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
      if (url === '/api/v1/broadcasts/broadcast-1/send-now') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'broadcast-1', status: 'scheduled', mode: 'queued' } }),
        } as Response
      }
      if (url === '/api/v1/broadcasts/broadcast-2/pause') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'broadcast-2', status: 'paused' } }),
        } as Response
      }
      if (url === '/api/v1/broadcasts/broadcast-3/resume') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'broadcast-3', status: 'scheduled' } }),
        } as Response
      }
      if (url === '/api/v1/campaigns/campaign-1/launch') {
        return {
          ok: true,
          json: async () => ({ data: { enrolled: 24, audienceSize: 24 } }),
        } as Response
      }
      if (url === '/api/v1/campaigns/campaign-1/approve-all') {
        return {
          ok: true,
          json: async () => ({ data: { campaignId: 'campaign-1', approved: { total: 3 } } }),
        } as Response
      }
      if (url === '/api/v1/campaigns/campaign-2/archive') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'campaign-2', status: 'archived' } }),
        } as Response
      }
      if (url === '/api/v1/forms/form-1/submissions/submission-1') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'submission-1', status: 'read' } }),
        } as Response
      }
      if (url === '/api/enquiries/enquiry-1') {
        return {
          ok: true,
          json: async () => ({ id: 'enquiry-1', status: 'reviewing' }),
        } as Response
      }
      if (url === '/api/v1/social/inbox/social-inbox-1') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'social-inbox-1', status: 'read' } }),
        } as Response
      }
      if (url === '/api/v1/portal/email/messages/mailbox-1') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'mailbox-1', folder: 'archive', read: true } }),
        } as Response
      }
      if (url === '/api/v1/portal/email/messages') {
        return {
          ok: true,
          json: async () => ({ data: { message: { id: 'draft-1', status: 'draft' } } }),
        } as Response
      }
      if (url === '/api/v1/admin/agents/theo/runs/run-live-1/approval') {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response
      }
      if (url === '/api/v1/workspace-broker/jobs/broker-job-1') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'broker-job-1', status: 'queued' } }),
        } as Response
      }
      if (url === '/api/v1/calendar/events/event-1/rsvp') {
        return {
          ok: true,
          json: async () => ({ data: { id: 'event-1', attendees: [{ email: 'ava@example.test', status: 'accepted' }] } }),
        } as Response
      }
      if (url === '/api/bookings/booking-1') {
        return {
          ok: true,
          json: async () => ({ id: 'booking-1', status: 'completed' }),
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
    expect(screen.getByLabelText('Live briefing cards')).toHaveClass('xl:overflow-y-auto')
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

  it('logs and clears stale CRM contact follow-up cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Follow up Ava Owner/i }))

    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/contacts/contact-1')
    expect(screen.getByText('Ava Owner (contact-1)')).toBeInTheDocument()
    expect(screen.getByText('proposal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark contact followed up/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Follow-up note'), { target: { value: 'Called Ava; proposal decision due tomorrow.' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark contact followed up/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /mark contact followed up/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/activities', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          contactId: 'contact-1',
          dealId: '',
          type: 'note',
          summary: 'Called Ava; proposal decision due tomorrow.',
          metadata: {
            sourceBriefingId: 'contact:contact-1',
            sourceContactId: 'contact-1',
            source: 'briefings-control-desk',
          },
        }),
      }))
    })
    await waitFor(() => {
      const contactCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => url === '/api/v1/crm/contacts/contact-1')
      expect(contactCall).toBeDefined()
      expect(contactCall?.[1]).toMatchObject({ method: 'PATCH' })
      expect(JSON.parse(String(contactCall?.[1]?.body)).lastContactedAt).toMatch(/^2026-05-31T10:05:00\.\d{3}Z$/)
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

  it('accepts and declines received quote cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Quote awaiting decision: QUO-1001/i }))

    expect(screen.getByText('QUO-1001 (quote-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/payments?quote=quote-1')
    expect(screen.getByRole('button', { name: /accept quote/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /decline quote/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /accept quote/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/quotes/quote-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'accepted' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /accept quote/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /decline quote/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/quotes/quote-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'declined' }),
      }))
    })
  })

  it('marks active shipment cards delivered or failed from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Shipment in transit: DHL-123/i }))

    expect(screen.getByText('DHL-123 (shipment-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/companies/company-1?shipment=shipment-1')
    expect(screen.getByRole('button', { name: /mark delivered/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark shipment failed/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark delivered/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/shipments?id=shipment-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'delivered' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark delivered/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /mark shipment failed/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/shipments?id=shipment-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'failed' }),
      }))
    })
  })

  it('advances and cancels order cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Order blocked: Website onboarding order/i }))

    expect(screen.getByText('Website onboarding order (order-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/companies/company-1?order=order-1')
    expect(screen.getByRole('button', { name: /mark order in progress/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark order fulfilled/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel order/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark order in progress/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/orders?id=order-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress', fulfillmentStatus: 'picking' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark order in progress/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /mark order fulfilled/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/orders?id=order-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'fulfilled', fulfillmentStatus: 'delivered' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark order fulfilled/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /cancel order/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/orders?id=order-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      }))
    })
  })

  it('resolves inventory risk cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Low stock: SEO implementation hours/i }))

    expect(screen.getByText('SEO implementation hours (stock-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/companies/company-1?inventory=stock-1')
    expect(screen.getByRole('button', { name: /mark inventory restocked/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archive inventory item/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark inventory restocked/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/inventory-items?id=stock-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark inventory restocked/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /archive inventory item/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/inventory-items?id=stock-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      }))
    })
  })

  it('handles public enquiry follow-up cards from the admin control desk', async () => {
    render(<BriefingControlDesk mode="admin" />)

    fireEvent.click(await screen.findByRole('button', { name: /New enquiry from Ava Owner/i }))

    expect(screen.getByText('Ava Owner (enquiry-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/admin/briefings?source=enquiry&id=enquiry-1')
    expect(screen.getByRole('button', { name: /mark enquiry reviewing/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark enquiry active/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close enquiry/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark enquiry reviewing/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/enquiries/enquiry-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'reviewing' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark enquiry reviewing/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /mark enquiry active/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/enquiries/enquiry-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close enquiry/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /close enquiry/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/enquiries/enquiry-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed' }),
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

  it('sends, pauses, and resumes broadcast cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Broadcast ready to send: June newsletter/i }))
    expect(screen.getByText('June newsletter (broadcast-1)')).toBeInTheDocument()
    expect(screen.getByText('June growth update')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/campaigns/broadcast/broadcast-1')
    fireEvent.click(screen.getByRole('button', { name: /send broadcast now/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/broadcasts/broadcast-1/send-now', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ immediate: false }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send broadcast now/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Broadcast scheduled: Product webinar invite/i }))
    expect(screen.getByText('Product webinar invite (broadcast-2)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /pause broadcast/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/broadcasts/broadcast-2/pause', expect.objectContaining({ method: 'POST' }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pause broadcast/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Broadcast paused: Renewal reminder/i }))
    expect(screen.getByText('Renewal reminder (broadcast-3)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /resume broadcast/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/broadcasts/broadcast-3/resume', expect.objectContaining({ method: 'POST' }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /resume broadcast/i })).not.toBeDisabled()
    })
  })

  it('launches, bulk-approves, and archives campaign cards from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Campaign ready to launch: Lead nurture launch/i }))
    expect(screen.getByText('Lead nurture launch (campaign-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/campaigns/campaign-1')
    expect(screen.getByText('sequence-1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /approve campaign assets/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/campaigns/campaign-1/approve-all', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'all' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^launch campaign$/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /^launch campaign$/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/campaigns/campaign-1/launch', expect.objectContaining({ method: 'POST' }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^launch campaign$/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Campaign active: Retention nurture/i }))
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/campaigns/campaign-2')
    })
    expect(screen.getByText('Retention nurture (campaign-2)')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^archive campaign$/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /^archive campaign$/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/campaigns/campaign-2/archive', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ force: false }),
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

  it('marks social inbox engagement read, replied, or archived from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Social DM needs reply from Mia Prospect/i }))

    expect(screen.getByText('Mia Prospect (social-inbox-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/admin/social/inbox?item=social-inbox-1')
    expect(screen.getByRole('button', { name: /mark engagement read/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark engagement replied/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archive engagement/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark engagement read/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/inbox/social-inbox-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'read' }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark engagement replied/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /mark engagement replied/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/inbox/social-inbox-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'replied' }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /archive engagement/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /archive engagement/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/social/inbox/social-inbox-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      }))
    })
  })

  it('marks mailbox messages read, archives them, and drafts replies from the control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /Unread email from Client Lead/i }))

    expect(screen.getByText('Client Lead (mailbox-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/email?message=mailbox-1')
    expect(screen.getByRole('button', { name: /mark email read/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archive email/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /draft email reply/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /mark email read/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/email/messages/mailbox-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ read: true }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /archive email/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /archive email/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/email/messages/mailbox-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ folder: 'archive' }),
      }))
    })

    fireEvent.change(screen.getByLabelText('Mailbox reply draft'), { target: { value: 'Yes, I can do Tuesday afternoon.' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /draft email reply/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /draft email reply/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/email/messages', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'draft',
          accountId: 'account-1',
          to: ['lead@example.test'],
          subject: 'Re: Can we book a call?',
          bodyText: 'Yes, I can do Tuesday afternoon.',
        }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Mailbox reply draft')).toHaveValue('')
    })
  })

  it('approves and denies paused agent runs from the admin control desk', async () => {
    render(<BriefingControlDesk mode="admin" />)

    fireEvent.click(await screen.findByRole('button', { name: /Theo paused for approval/i }))

    expect(screen.getByText('theo-main (run-live-1)')).toBeInTheDocument()
    expect(screen.getByText('shell.exec')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/admin/agents/theo?run=run-live-1')
    expect(screen.getByRole('button', { name: /approve run once/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deny run/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /approve run once/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/agents/theo/runs/run-live-1/approval', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ choice: 'once' }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /deny run/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /deny run/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/agents/theo/runs/run-live-1/approval', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ choice: 'deny' }),
      }))
    })
  })

  it('approves and rejects workspace broker jobs from the admin control desk', async () => {
    render(<BriefingControlDesk mode="admin" />)

    fireEvent.click(await screen.findByRole('button', { name: /Workspace share request needs approval/i }))

    expect(screen.getByText('request_share (broker-job-1)')).toBeInTheDocument()
    expect(screen.getByText('Client-facing plan (artifact-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/admin/knowledge/workspace-broker/jobs/broker-job-1')
    expect(screen.getByRole('button', { name: /approve workspace job/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject workspace job/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /approve workspace job/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/workspace-broker/jobs/broker-job-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject workspace job/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /reject workspace job/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/workspace-broker/jobs/broker-job-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject' }),
      }))
    })
  })

  it('accepts and declines calendar event RSVPs from the portal control desk', async () => {
    render(<BriefingControlDesk mode="portal" />)

    fireEvent.click(await screen.findByRole('button', { name: /RSVP needed: Website retainer check-in/i }))

    expect(screen.getByText('Website retainer check-in (event-1)')).toBeInTheDocument()
    expect(screen.getByText('Ava Owner (contact-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/portal/contacts/contact-1?event=event-1')
    expect(screen.getByRole('button', { name: /accept meeting/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /decline meeting/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /accept meeting/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/calendar/events/event-1/rsvp', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'ava@example.test', status: 'accepted' }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /decline meeting/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /decline meeting/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/calendar/events/event-1/rsvp', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'ava@example.test', status: 'declined' }),
      }))
    })
  })

  it('completes and cancels booking cards from the admin control desk', async () => {
    render(<BriefingControlDesk mode="admin" />)

    fireEvent.click(await screen.findByRole('button', { name: /Booking needs Meet link: Mia Founder/i }))

    expect(screen.getByText('Mia Founder (booking-1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open source/i })).toHaveAttribute('href', '/admin/briefings?source=booking&id=booking-1')
    expect(screen.getByRole('button', { name: /mark booking completed/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel booking/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark booking completed/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/bookings/booking-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel booking/i })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /cancel booking/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/bookings/booking-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      }))
    })
  })
})
