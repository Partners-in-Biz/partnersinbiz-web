import type { CrmStarterTemplate, PipelineStarterTemplate } from './types'

export const CRM_STARTER_TEMPLATES: CrmStarterTemplate[] = [
  {
    id: 'pipeline-simple-sales',
    kind: 'pipeline',
    name: 'Simple sales pipeline',
    description: 'A lightweight lead to close flow for small teams and founder-led sales.',
    recommendedFor: ['simple_sales'],
    stages: [
      { id: 'new_lead', label: 'New lead', kind: 'open', order: 0, probability: 10, color: '#38bdf8' },
      { id: 'qualified', label: 'Qualified', kind: 'open', order: 1, probability: 30, color: '#a78bfa' },
      { id: 'proposal', label: 'Proposal sent', kind: 'open', order: 2, probability: 60, color: '#f59e0b' },
      { id: 'won', label: 'Won', kind: 'won', order: 3, probability: 100, color: '#22c55e' },
      { id: 'lost', label: 'Lost', kind: 'lost', order: 4, probability: 0, color: '#ef4444' },
    ],
  },
  {
    id: 'pipeline-consultative',
    kind: 'pipeline',
    name: 'Consultative sales',
    description: 'For higher-value deals that need discovery, diagnosis, and a tailored proposal.',
    recommendedFor: ['consultative_sales'],
    stages: [
      { id: 'inbound', label: 'Inbound', kind: 'open', order: 0, probability: 10, color: '#38bdf8' },
      { id: 'discovery', label: 'Discovery booked', kind: 'open', order: 1, probability: 25, color: '#818cf8' },
      { id: 'diagnosis', label: 'Needs mapped', kind: 'open', order: 2, probability: 45, color: '#a78bfa' },
      { id: 'proposal', label: 'Proposal', kind: 'open', order: 3, probability: 70, color: '#f59e0b' },
      { id: 'won', label: 'Won', kind: 'won', order: 4, probability: 100, color: '#22c55e' },
      { id: 'lost', label: 'Lost', kind: 'lost', order: 5, probability: 0, color: '#ef4444' },
    ],
  },
  {
    id: 'pipeline-renewals',
    kind: 'pipeline',
    name: 'Renewals and expansion',
    description: 'Track renewals, upsells, and expansion conversations for existing clients.',
    recommendedFor: ['renewals'],
    stages: [
      { id: 'upcoming', label: 'Upcoming renewal', kind: 'open', order: 0, probability: 40, color: '#38bdf8' },
      { id: 'engaged', label: 'Client engaged', kind: 'open', order: 1, probability: 65, color: '#a78bfa' },
      { id: 'commercials', label: 'Commercials sent', kind: 'open', order: 2, probability: 80, color: '#f59e0b' },
      { id: 'renewed', label: 'Renewed', kind: 'won', order: 3, probability: 100, color: '#22c55e' },
      { id: 'churned', label: 'Churned', kind: 'lost', order: 4, probability: 0, color: '#ef4444' },
    ],
  },
  {
    id: 'sequence-new-lead',
    kind: 'sequence',
    name: 'New lead follow-up',
    description: 'A short human follow-up sequence after a new enquiry or imported lead.',
    recommendedFor: ['simple_sales', 'consultative_sales'],
    steps: [
      { delayDays: 0, subject: 'Thanks for reaching out', purpose: 'Acknowledge the lead and ask one qualifying question.' },
      { delayDays: 2, subject: 'Quick check-in', purpose: 'Follow up with a relevant proof point.' },
      { delayDays: 5, subject: 'Should I close the loop?', purpose: 'Create a clear final nudge.' },
    ],
  },
  {
    id: 'segment-hot-leads',
    kind: 'segment',
    name: 'Hot leads',
    description: 'A starter segment for recently active leads with sales-ready intent.',
    recommendedFor: ['simple_sales', 'consultative_sales'],
    rules: ['type is lead', 'last activity within 14 days', 'lead score above 70'],
  },
  {
    id: 'form-qualified-enquiry',
    kind: 'form',
    name: 'Qualified enquiry form',
    description: 'A practical enquiry form that captures budget, timeline, and service fit.',
    recommendedFor: ['simple_sales', 'consultative_sales'],
    fields: ['Name', 'Email', 'Company', 'Service needed', 'Budget range', 'Timeline'],
  },
]

export function getStarterTemplate(id: string): CrmStarterTemplate | null {
  return CRM_STARTER_TEMPLATES.find((template) => template.id === id) ?? null
}

export function getPipelineStarterTemplate(id: string): PipelineStarterTemplate | null {
  const template = getStarterTemplate(id)
  return template?.kind === 'pipeline' ? template : null
}
