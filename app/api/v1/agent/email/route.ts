import { withMailboxAuth } from '@/lib/mailbox/mailboxAuth'
import { apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const GET = withMailboxAuth('client', async () => apiSuccess({
  toolset: 'agent-email',
  version: '2026-07-23.v3',
  scope: 'All operations require explicit orgId and uid/requestingUserId. Interactive Messages runs may authorize via the injected user-delegation Bearer token (self mailbox). Agent/system keys still need mailbox_agent_delegations or a scoped mailbox API-key permission.',
  delegation: {
    required: true,
    queryOrBody: ['delegationEvidenceId', 'delegationEvidence.id|delegationEvidence.delegationEvidenceId'],
    acceptedEvidence: [
      'self: non-ai caller whose uid+orgId match the requested mailbox',
      'mailbox_agent_delegations active/approved record scoped to actor+orgId+uid+actionClass',
      'agent_api_key permission resource mailbox:<orgId>:<uid> with read|draft|send action',
    ],
    legacyAiKey: 'Not sufficient without a delegation record.',
  },
  auditCollections: ['mailbox_agent_tool_events', 'mailbox_send_requests', 'mailbox_audit_events', 'activities'],
  tools: [
    {
      name: 'email.accounts.list',
      method: 'GET',
      path: '/api/v1/agent/email/accounts',
      query: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId?'],
      safety: 'Read-only; lists connected Gmail/SMTP accounts for the requested user/org without secrets.',
    },
    {
      name: 'email.messages.read',
      method: 'GET',
      path: '/api/v1/agent/email/messages',
      query: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId', 'folder?', 'accountId?', 'q?', 'limit?', 'summarize?'],
      safety: 'Read-only; requires read delegation and returns messages scoped by orgId + uid + optional accountId. summarize=true still includes bodyPreview (≤8k).',
    },
    {
      name: 'email.messages.get',
      method: 'GET',
      path: '/api/v1/agent/email/messages/{id}',
      query: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId?'],
      safety: 'Read-only; returns the full mailbox message (including bodyText) for one id in the same org/uid scope.',
    },
    {
      name: 'email.context.summarise',
      method: 'GET',
      path: '/api/v1/agent/email/messages?summarize=true',
      query: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId', 'folder?', 'accountId?', 'q?', 'limit?'],
      safety: 'Requires read delegation. Returns metadata + bodyPreview. For longer mail, follow up with GET /messages/{id}. Never ask the user to paste when connected.',
    },
    {
      name: 'email.draft.create',
      method: 'POST',
      path: '/api/v1/agent/email/drafts',
      body: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId|delegationEvidence', 'accountId?', 'to', 'cc?', 'bcc?', 'subject', 'bodyText', 'bodyHtml?'],
      safety: 'Requires draft delegation, creates a draft in the requesting user/org account context, and records an agent tool event.',
      returns: ['message', 'contextRef (type=email)', 'uiActions (open_context → Review email draft in Messages canvas)'],
      chatHandoff: 'Echo uiActions/contextRef into the assistant message so Messages can attach the draft and open the email side canvas for human review before send.',
    },
    {
      name: 'email.reply.create',
      method: 'POST',
      path: '/api/v1/agent/email/replies',
      body: ['orgId', 'uid|requestingUserId', 'delegationEvidenceId|delegationEvidence', 'sourceMessageId', 'accountId?', 'bodyText', 'bodyHtml?'],
      safety: 'Requires draft delegation and creates a reply draft only after loading the source message from the same orgId + uid scope.',
      returns: ['message', 'contextRef (type=email)', 'uiActions (open_context → Review email draft in Messages canvas)'],
      chatHandoff: 'Echo uiActions/contextRef into the assistant message so Messages can attach the draft and open the email side canvas for human review before send.',
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
