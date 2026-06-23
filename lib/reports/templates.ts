// lib/reports/templates.ts
//
// Email-template registry for report sends + schedules (US-177 / US-189).
// Templates are tone/layout variants the share + schedule UIs let the operator
// pick from. The send route renders the chosen template around the report link.

export interface ReportEmailTemplate {
  id: string
  name: string
  description: string
  /** Eyebrow line shown above the org name in the email header. */
  eyebrow: string
  /** Default subject line ({org} and {period} are interpolated). */
  subject: string
}

export const REPORT_EMAIL_TEMPLATES: ReportEmailTemplate[] = [
  {
    id: 'standard',
    name: 'Standard performance',
    description: 'Branded monthly performance summary with the headline revenue tile.',
    eyebrow: 'Monthly performance report',
    subject: '{org} · Performance report · {period}',
  },
  {
    id: 'executive',
    name: 'Executive brief',
    description: 'Tighter, executive-summary-first layout for stakeholders.',
    eyebrow: 'Executive brief',
    subject: '{org} — Executive brief ({period})',
  },
  {
    id: 'analytics',
    name: 'Analytics digest',
    description: 'Traffic and engagement framing for analytics-led reports.',
    eyebrow: 'Analytics digest',
    subject: '{org} · Analytics digest · {period}',
  },
  {
    id: 'minimal',
    name: 'Minimal link',
    description: 'A short note and a button — no metric preview.',
    eyebrow: 'Your report is ready',
    subject: 'Your {org} report is ready',
  },
]

export const DEFAULT_REPORT_TEMPLATE = 'standard'

export function getReportTemplate(id: string | undefined | null): ReportEmailTemplate {
  return (
    REPORT_EMAIL_TEMPLATES.find((t) => t.id === id) ??
    REPORT_EMAIL_TEMPLATES[0]
  )
}

export function renderTemplateSubject(
  templateId: string | undefined | null,
  vars: { org: string; period: string },
): string {
  const tpl = getReportTemplate(templateId)
  return tpl.subject.replace('{org}', vars.org).replace('{period}', vars.period)
}
