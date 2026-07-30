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
    line('Return the decision first, followed by evidence, reusable workflow, next actions, and safety readback in the dynamic Messages window.'),
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
