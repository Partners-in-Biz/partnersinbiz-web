import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => apiSuccess({
  toolset: 'agent-email',
  version: '2026-05-26.v1',
  scope: 'All operations require explicit orgId and uid/requestingUserId so agents read and write in the requesting user/org mailbox context, never the agent credential context.',
  auditCollections: ['mailbox_agent_tool_events', 'mailbox_send_requests', 'mailbox_audit_events', 'activities'],
  tools: [
    {
      name: 'email.messages.read',
      method: 'GET',
      path: '/api/v1/agent/email/messages',
      query: ['orgId', 'uid|requestingUserId', 'folder?', 'accountId?', 'q?', 'limit?', 'summarize?'],
      safety: 'Read-only; returns messages scoped by orgId + uid + optional accountId.',
    },
    {
      name: 'email.context.summarise',
      method: 'GET',
      path: '/api/v1/agent/email/messages?summarize=true',
      query: ['orgId', 'uid|requestingUserId', 'folder?', 'accountId?', 'q?', 'limit?'],
      safety: 'Returns bounded snippets/metadata only, not full message bodies.',
    },
    {
      name: 'email.draft.create',
      method: 'POST',
      path: '/api/v1/agent/email/drafts',
      body: ['orgId', 'uid|requestingUserId', 'accountId?', 'to', 'cc?', 'bcc?', 'subject', 'bodyText', 'bodyHtml?'],
      safety: 'Creates a draft in the requesting user/org account context and records an agent tool event.',
    },
    {
      name: 'email.reply.create',
      method: 'POST',
      path: '/api/v1/agent/email/replies',
      body: ['orgId', 'uid|requestingUserId', 'sourceMessageId', 'accountId?', 'bodyText', 'bodyHtml?'],
      safety: 'Creates a reply draft only after loading the source message from the same orgId + uid scope.',
    },
    {
      name: 'email.send.request',
      method: 'POST',
      path: '/api/v1/agent/email/send-requests',
      body: ['orgId', 'uid|requestingUserId', 'accountId', 'to', 'cc?', 'bcc?', 'subject', 'bodyText', 'bodyHtml?', 'dryRun?', 'approvalEvidence'],
      approvalEvidence: ['approvalGateTaskId|approvalTaskId|approvalCommentId|evidenceUrl', 'approvedBy?', 'approvedAt?', 'reason?'],
      safety: 'Fails closed without approval evidence; records a send request and agent audit event before approved provider delivery.',
    },
  ],
}))
