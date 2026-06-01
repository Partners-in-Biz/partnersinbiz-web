import { render } from '@testing-library/react'
import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'
import type {
  ClientDocument,
  ClientDocumentVersion,
  DocumentBlock,
  DocumentBlockType,
} from '@/lib/client-documents/types'
import { SHOWCASE_DOCUMENT_BLOCK_TYPES } from '@/lib/client-documents/types'

// jsdom doesn't ship IntersectionObserver; the motion hooks need a no-op stub.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
;(globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
  IntersectionObserverStub as unknown as typeof IntersectionObserver

const ALL_TYPES: DocumentBlockType[] = [
  'hero',
  'summary',
  'problem',
  'scope',
  'deliverables',
  'timeline',
  'investment',
  'terms',
  'approval',
  'metrics',
  'risk',
  'table',
  'gallery',
  'callout',
  'rich_text',
  'image',
  'video',
  'embed',
  'link_card',
  'chart',
  'pricing_toggle',
  'faq',
  'comparison',
  ...SHOWCASE_DOCUMENT_BLOCK_TYPES,
]

const FIXTURES: Record<DocumentBlockType, unknown> = {
  hero: 'Subtitle text',
  summary: 'Body text',
  problem: 'Problem statement',
  scope: ['One', 'Two'],
  deliverables: ['Item A', 'Item B'],
  timeline: { phases: [{ label: 'Phase 1', duration: '1w' }] },
  investment: {
    items: [
      { label: 'A', amount: 100 },
      { label: 'B', amount: 200 },
    ],
    total: 300,
    currency: 'ZAR',
  },
  terms: 'Terms text',
  approval: 'Approve me',
  metrics: { items: [{ label: 'KPI', value: '90', target: '100' }] },
  risk: ['Risk one'],
  table: { headers: ['A', 'B'], rows: [['1', '2']] },
  gallery: ['https://placehold.co/300x200'],
  callout: { title: 'Note', body: 'Body', variant: 'info' },
  rich_text: 'Some rich text',
  image: { url: 'https://placehold.co/600x400', caption: 'Caption' },
  video: { url: 'https://youtu.be/dQw4w9WgXcQ' },
  embed: { url: 'https://calendly.com/peetstander' },
  link_card: { url: 'https://partnersinbiz.online', title: 'PiB', description: 'desc' },
  chart: {
    kind: 'bar',
    data: [
      { name: 'A', value: 1 },
      { name: 'B', value: 2 },
    ],
  },
  pricing_toggle: {
    items: [
      { label: 'Base', amount: 100, required: true },
      { label: 'Add-on', amount: 50 },
    ],
    currency: 'ZAR',
  },
  faq: { items: [{ q: 'Q?', a: 'A.' }] },
  comparison: {
    headers: ['PiB', 'Other'],
    rows: [{ label: 'Speed', values: [true, false] }],
    highlightCol: 0,
  },
  funnel: {
    eyebrow: 'Pipeline',
    headline: 'Lead journey',
    stages: [
      { id: 'aware', label: 'Aware', value: 120, description: 'Top of funnel', conversionRate: 100 },
      { id: 'booked', label: 'Booked', value: 24, description: 'Sales calls', conversionRate: 20 },
    ],
  },
  radar: {
    eyebrow: 'Readiness',
    headline: 'Capability radar',
    axes: [
      { id: 'brand', label: 'Brand', value: 8, max: 10, benchmark: 6 },
      { id: 'sales', label: 'Sales', value: 5, max: 10, benchmark: 7 },
    ],
  },
  quadrant_matrix: {
    eyebrow: 'Priorities',
    headline: 'Opportunity matrix',
    xAxis: { label: 'Impact', minLabel: 'Low', maxLabel: 'High' },
    yAxis: { label: 'Effort', minLabel: 'Easy', maxLabel: 'Hard' },
    items: [{ id: 'automation', label: 'Automation', x: 82, y: 35, description: 'Quick win' }],
  },
  before_after: {
    eyebrow: 'Transformation',
    headline: 'Before and after',
    pairs: [
      {
        id: 'reporting',
        label: 'Reporting',
        before: 'Manual spreadsheets',
        after: 'Live client dashboard',
        evidence: 'Weekly updates saved',
      },
    ],
  },
  roadmap_gantt: {
    eyebrow: 'Delivery',
    headline: 'Launch roadmap',
    items: [
      { id: 'strategy', label: 'Strategy', start: '2026-05-01', end: '2026-05-08', lane: 'Plan', status: 'complete' },
      {
        id: 'build',
        label: 'Build',
        start: '2026-05-09',
        end: '2026-05-20',
        lane: 'Ship',
        status: 'in_progress',
        dependsOn: ['strategy'],
      },
    ],
    milestones: [{ id: 'launch', label: 'Launch', date: '2026-05-25' }],
  },
  logo_testimonial_proof: {
    eyebrow: 'Proof',
    headline: 'Client proof',
    proof: [
      { id: 'logo', kind: 'logo', organisationName: 'Acme Co' },
      { id: 'quote', kind: 'testimonial', quote: 'PiB made the work visible.', personName: 'Alex', personRole: 'Founder' },
    ],
  },
  case_study_result_cards: {
    eyebrow: 'Results',
    headline: 'Case study cards',
    cards: [
      {
        id: 'retention',
        title: 'Retention lift',
        result: '+32%',
        narrative: 'Lifecycle follow-up improved repeat bookings.',
        timeframe: '60 days',
      },
    ],
  },
  weighted_decision_matrix: {
    eyebrow: 'Decision',
    headline: 'Weighted decision',
    criteria: [
      { id: 'impact', label: 'Impact', weight: 0.6 },
      { id: 'speed', label: 'Speed', weight: 0.4 },
    ],
    options: [
      { id: 'crm', label: 'CRM cleanup', scores: { impact: 8, speed: 7 }, recommended: true, summary: 'Best next move' },
      { id: 'ads', label: 'Ads scale-up', scores: { impact: 7, speed: 4 } },
    ],
  },
}

test('renders every registered block type without errors', () => {
  const doc: ClientDocument = {
    id: 'd',
    orgId: 'o',
    title: 'Test',
    type: 'sales_proposal',
    templateId: 'sales-proposal-v1',
    status: 'internal_draft',
    linked: {},
    currentVersionId: 'v1',
    approvalMode: 'formal_acceptance',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    assumptions: [],
    shareToken: 't',
    shareEnabled: true,
    editShareEnabled: false,
    createdBy: 'u',
    createdByType: 'agent',
    updatedBy: 'u',
    updatedByType: 'agent',
    deleted: false,
  }
  const blocks: DocumentBlock[] = ALL_TYPES.map((type, i) => ({
    id: `b${i}`,
    type,
    content: FIXTURES[type],
    required: true,
    display: {},
  }))
  const version: ClientDocumentVersion = {
    id: 'v1',
    documentId: 'd',
    versionNumber: 1,
    status: 'draft',
    blocks,
    theme: {
      palette: { bg: '#000', text: '#fff', accent: '#F5A623' },
      typography: { heading: 'sans-serif', body: 'sans-serif' },
    },
    createdBy: 'u',
    createdByType: 'agent',
  }
  // Should not throw; jsdom doesn't run Recharts measurement but smoke check is enough
  expect(() => render(<DocumentRenderer document={doc} version={version} />)).not.toThrow()
})

test('renders showcase blocks with native renderers, card surfaces, and semantic labels', () => {
  const doc: ClientDocument = {
    id: 'd',
    orgId: 'o',
    title: 'Showcase Test',
    type: 'change_request',
    templateId: 'change-request-v1',
    status: 'internal_draft',
    linked: {},
    currentVersionId: 'v1',
    approvalMode: 'operational',
    clientPermissions: { canComment: true, canSuggest: true, canDirectEdit: false, canApprove: true },
    assumptions: [],
    shareToken: 't',
    shareEnabled: false,
    editShareEnabled: false,
    createdBy: 'u',
    createdByType: 'agent',
    updatedBy: 'u',
    updatedByType: 'agent',
    deleted: false,
  }
  const version: ClientDocumentVersion = {
    id: 'v1',
    documentId: 'd',
    versionNumber: 1,
    status: 'draft',
    blocks: SHOWCASE_DOCUMENT_BLOCK_TYPES.map((type, i) => ({
      id: `showcase-${type}`,
      type,
      title: `Showcase ${type}`,
      content: FIXTURES[type],
      required: true,
      display: { motion: i % 2 === 0 ? 'reveal' : 'none' },
    })),
    theme: {
      palette: { bg: '#000', text: '#fff', accent: '#F5A623' },
      typography: { heading: 'sans-serif', body: 'sans-serif' },
    },
    createdBy: 'u',
    createdByType: 'agent',
  }

  const { container, getByRole, queryByText } = render(<DocumentRenderer document={doc} version={version} />)

  expect(queryByText(/No renderer registered/)).not.toBeInTheDocument()
  expect(getByRole('img', { name: /Capability radar/i })).toBeInTheDocument()
  expect(getByRole('table', { name: /Weighted decision/i })).toBeInTheDocument()
  expect(container.querySelectorAll('.pib-card').length).toBeGreaterThanOrEqual(SHOWCASE_DOCUMENT_BLOCK_TYPES.length)
  expect(container.querySelector('[data-motion="reveal"]')).toBeInTheDocument()
})

test('renders formal agreement signature evidence for both parties', () => {
  const doc: ClientDocument = {
    id: 'd',
    orgId: 'o',
    title: 'Master services agreement',
    type: 'sales_proposal',
    templateId: 'sales-proposal-v1',
    status: 'accepted',
    linked: {},
    currentVersionId: 'v1',
    latestPublishedVersionId: 'v1',
    approvalMode: 'formal_acceptance',
    clientPermissions: { canComment: true, canSuggest: true, canDirectEdit: false, canApprove: true },
    assumptions: [],
    shareToken: 't',
    shareEnabled: true,
    editShareEnabled: false,
    providerSignature: {
      versionId: 'v1',
      name: 'Peet Stander',
      capacity: 'Founder',
      companyName: 'The Partners in Business',
      signatureText: 'Peet Stander',
      signedBy: 'admin-1',
      signedByType: 'user',
      signedAt: { _seconds: 1780228800, _nanoseconds: 0 },
    },
    clientAcceptance: {
      versionId: 'v1',
      actorId: 'client-1',
      actorName: 'Kumari Pillay',
      typedName: 'Kumari Pillay',
      companyName: 'Elemental',
      checkboxText: 'I have read and agree to the terms above',
      acceptedAt: { _seconds: 1780232400, _nanoseconds: 0 },
    },
    createdBy: 'u',
    createdByType: 'agent',
    updatedBy: 'u',
    updatedByType: 'agent',
    deleted: false,
  }
  const version: ClientDocumentVersion = {
    id: 'v1',
    documentId: 'd',
    versionNumber: 1,
    status: 'published',
    blocks: [{
      id: 'terms',
      type: 'terms',
      title: 'Terms',
      content: 'Agreement terms',
      required: true,
      display: {},
    }],
    theme: {
      palette: { bg: '#000', text: '#fff', accent: '#F5A623' },
      typography: { heading: 'sans-serif', body: 'sans-serif' },
    },
    createdBy: 'u',
    createdByType: 'agent',
  }

  const { getByText, getAllByText } = render(<DocumentRenderer document={doc} version={version} />)

  expect(getByText('Agreement signatures')).toBeInTheDocument()
  expect(getByText('Peet Stander')).toBeInTheDocument()
  expect(getByText('Founder')).toBeInTheDocument()
  expect(getByText('The Partners in Business')).toBeInTheDocument()
  expect(getByText('Kumari Pillay')).toBeInTheDocument()
  expect(getByText('Elemental')).toBeInTheDocument()
  expect(getAllByText('31 May 2026')).toHaveLength(2)
  expect(getByText('Formal electronic acceptance via platform')).toBeInTheDocument()
})

test('does not crash when legacy generated lists contain objects', () => {
  const doc: ClientDocument = {
    id: 'd',
    orgId: 'o',
    title: 'Legacy research report',
    type: 'research_report',
    templateId: 'research-report-v1',
    status: 'internal_draft',
    linked: {},
    currentVersionId: 'v1',
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    assumptions: [],
    shareToken: 't',
    shareEnabled: true,
    editShareEnabled: false,
    createdBy: 'u',
    createdByType: 'agent',
    updatedBy: 'u',
    updatedByType: 'agent',
    deleted: false,
  }
  const version: ClientDocumentVersion = {
    id: 'v1',
    documentId: 'd',
    versionNumber: 1,
    status: 'draft',
    blocks: [
      {
        id: 'findings',
        type: 'deliverables',
        title: 'Key findings',
        content: [{ title: 'Finding title', body: 'Finding body', confidence: 'high', status: 'verified', sources: ['s1'] }],
        required: true,
        display: {},
      },
      {
        id: 'next_steps',
        type: 'scope',
        title: 'Next steps',
        content: [{ title: 'Step title', body: 'Step body' }],
        required: true,
        display: {},
      },
    ],
    theme: {
      palette: { bg: '#000', text: '#fff', accent: '#F5A623' },
      typography: { heading: 'sans-serif', body: 'sans-serif' },
    },
    createdBy: 'u',
    createdByType: 'agent',
  }

  expect(() => render(<DocumentRenderer document={doc} version={version} />)).not.toThrow()
})
