import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => apiSuccess({
  toolset: 'agent-email',
  version: '2026-05-26.v2',
  scope: 'All operations require explicit orgId and uid/requestingUserId plus machine-checkable mailbox delegation evidence for that org/user/action, so agents cannot select arbitrary mailbox contexts.',
  delegation: {
    required: true,
    queryOrBody: ['delegationEvidenceId', 'delegationEvidence.id|delegationEvidence.delegationEvidenceId'],
    acceptedEvidence: ['mailbox_agent_delegations active/approved record scoped to actor+orgId+uid+actionClass', 'agent_api_key permission resource mailbox:<orgId>:<uid> with read|draft|send action'],
    legacyAiKey: 'Not sufficient without a delegation record.',
  },
  auditCollections: ['mailbox_agent_tool_events', 'mailbox_send_requests', 'mailbox_audit_events', 'activities'],
  tools: [
    {
      name: 'email.messages.read',
      method: 'GET',
      path: '/api/v1/agent/email/messages',
      query: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId', 'folder?', 'accountId?', 'q?', 'limit?', 'summarize?'],
      safety: 'Read-only; requires read delegation and returns messages scoped by orgId + uid + optional accountId.',
    },
    {
      name: 'email.context.summarise',
      method: 'GET',
      path: '/api/v1/agent/email/messages?summarize=true',
      query: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId', 'folder?', 'accountId?', 'q?', 'limit?'],
      safety: 'Requires read delegation and returns bounded snippets/metadata only, not full message bodies.',
    },
    {
      name: 'email.draft.create',
      method: 'POST',
      path: '/api/v1/agent/email/drafts',
      body: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId|delegationEvidence', 'accountId?', 'to', 'cc?', 'bcc?', 'subject', 'bodyText', 'bodyHtml?'],
      safety: 'Requires draft delegation, creates a draft in the requesting user/org account context, and records an agent tool event.',
    },
    {
      name: 'email.reply.create',
      method: 'POST',
      path: '/api/v1/agent/email/replies',
      body: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId|delegationEvidence', 'sourceMessageId', 'accountId?', 'bodyText', 'bodyHtml?'],
      safety: 'Requires draft delegation and creates a reply draft only after loading the source message from the same orgId + uid scope.',
    },
    {
      name: 'email.send.request',
      method: 'POST',
      path: '/api/v1/agent/email/send-requests',
      body: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId|delegationEvidence', 'accountId', 'to', 'cc?', 'bcc?', 'subject', 'bodyText', 'bodyHtml?', 'dryRun?', 'approvalEvidence'],
      approvalEvidence: ['approvalGateTaskId|approvalTaskId|approvalCommentId|evidenceUrl', 'approvedBy?', 'approvedAt?', 'reason?'],
      safety: 'Requires send delegation and fails closed without separate approval evidence; records a send request and agent audit event before approved provider delivery.',
    },
  ],
}))
