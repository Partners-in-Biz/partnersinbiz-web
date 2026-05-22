import { render } from '@testing-library/react'
import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'
import type {
  ClientDocument,
  ClientDocumentVersion,
  DocumentBlock,
  DocumentBlockType,
} from '@/lib/client-documents/types'

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
