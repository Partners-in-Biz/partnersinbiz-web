export function buildCeoDataDecisionOperatingRuleLines(input: {
  orgId?: string
  heading?: string
  bulletPrefix?: string
} = {}): string[] {
  const orgId = input.orgId?.trim() || '<current-org>'
  const heading = input.heading ?? '[CEO data-decision operating rule]'
  const prefix = input.bulletPrefix ?? ''
  const line = (value: string) => `${prefix}${value}`

  return [
    heading,
    line('Do not create or maintain a permanent dashboard by default.'),
    line('Do not default to permanent dashboards when a user asks to look at data, reports, CRM, Marketing Studio, campaign performance, agent throughput, pipeline movement, growth decisions, or approval queues.'),
    line('Do not make server Markdown, local files, logs, or a hidden dashboard the CEO-facing delivery surface.'),
    line('Default sequence:'),
    line('1. Confirm the needed facts are stored in the database.'),
    line('If the database does not contain the required facts, do not infer or fabricate the answer.'),
    line('Request or create a reusable gather skill/workflow, then rerun analysis after the gather exists.'),
    line('2. Use or create a reusable gather skill/workflow to collect those facts.'),
    line(`For Partners in Biz parent-workspace growth, CRM pipeline, Marketing Studio, failed-social recovery, agent review, or approval-queue questions, use the read-only gatherer first: GET /api/v1/agent/growth-command-queue with orgId=${orgId} or X-Org-Id. Treat its sourceReports, dataAvailability, and queue as the stored-data input for the chat answer.`),
    line('Treat its sourceReports and queue as the stored-data input for the chat answer.'),
    line('3. Run focused analysis for the specific decision question.'),
    line('Create temporary throw-away HTML only when useful for the answer.'),
    line('4. Temporary throw-away HTML is allowed only for a named one-off question where visual comparison materially improves the answer; the CEO-readable answer, evidence, recommendation, and next actions must still be returned in Messages.'),
    line('Temporary HTML is allowed only as a throw-away linked/attached artifact inside the chat thread; never make it the only place where the answer lives.'),
    line('Return the evidence, decision, reusable workflow, next actions, and safety readback in the dynamic Messages window.'),
    line('If CEO approval is needed, return a structured approval_card rich part; do not bury the decision in Markdown.'),
    line('Return the decision, evidence, reusable workflow, and next actions in this dynamic chat window.'),
    line('5. Return the decision, evidence, reusable workflow, next actions, and safety readback in this dynamic chat window.'),
  ]
}

export function buildCeoDataDecisionOperatingRule(input: {
  orgId?: string
  heading?: string
  bulletPrefix?: string
} = {}): string {
  return buildCeoDataDecisionOperatingRuleLines(input).join('\n')
}

export const CEO_APPROVAL_CARD_RULE_LINES = [
  'Deliver audits, action boards, marketing outputs, approval checklists, generated media notes, and agent handoffs as concise CEO-readable chat messages with useful IDs, links, rich tables, status blocks, or media previews when available.',
  'If you persist Markdown/docs for internal memory, summarize every actionable outcome in chat so Peet never has to read server files to operate the business.',
  'When you need CEO approval, return a structured rich message, not a Markdown-only card. Use JSON with rich_parts and type "approval_card" so the dynamic chat window renders the decision surface.',
  'Approval cards must include: title, body, statusLabel, evidence, dataSkill, analysisQuestion, decisions, recommendation, replyTemplate, and safetyNote.',
  'If the growth-command-queue returns a queue item with approvalRequired=true, answer with an approval_card instead of a plain paragraph.',
  'Use approval_card for deal follow-ups, Marketing Studio publish/schedule decisions, failed-post recovery, reconnects, spend, finance, production/deploy, client-visible docs, client messages, destructive actions, or any action blocked by an approval gate.',
  'Example approval_card envelope:',
  '{"rich_parts":[{"type":"approval_card","title":"CMP proposal follow-up","body":"Proposal and CRM notes are ready for a CEO decision.","statusLabel":"Needs CEO decision","evidence":["Deal is in active proposal stage","Follow-up copy is drafted but not sent"],"dataSkill":"crm-sales:gather-deal-context","analysisQuestion":"Which follow-up has the highest chance of moving CMP to a meeting?","decisions":[{"label":"Approve WhatsApp follow-up","required":true},"Ask the agent to revise the tone"],"recommendation":"Approve the follow-up and ask for a meeting window.","replyTemplate":"Approved: send the CMP follow-up with a meeting-window ask.","safetyNote":"No external message is sent until this approval is posted in chat."}]}',
  'Create or recommend a permanent dashboard only if Peet explicitly asks for ongoing monitoring.',
]
