import type {
  DocumentBlock,
  DocumentTheme,
  ShowcaseBlockContentByType,
  ShowcaseDocumentBlockType,
} from './types'

export type ShowcaseDocumentBlockInput<TType extends ShowcaseDocumentBlockType = ShowcaseDocumentBlockType> = {
  type: TType
  id?: string
  title?: string
  content: ShowcaseBlockContentByType[TType]
  required?: boolean
  locked?: boolean
  clientEditable?: boolean
  display?: DocumentBlock['display']
}

export type InternalShowcaseVersionPayload = {
  blocks: DocumentBlock[]
  theme: DocumentTheme
  changeSummary: string
}

const INTERNAL_SHOWCASE_THEME: DocumentTheme = {
  brandName: 'Partners in Biz',
  palette: {
    bg: '#07070A',
    text: '#F7F4EE',
    accent: '#F5A623',
    muted: '#A7A29A',
  },
  typography: {
    heading: 'Instrument Serif',
    body: 'Geist',
  },
}

function cloneFirestoreSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createShowcaseDocumentBlock<TType extends ShowcaseDocumentBlockType>({
  type,
  id,
  title,
  content,
  required = true,
  locked = false,
  clientEditable = false,
  display = {},
}: ShowcaseDocumentBlockInput<TType>): DocumentBlock {
  return {
    id: id ?? `showcase-${type}`,
    type,
    ...(title ? { title } : {}),
    content: cloneFirestoreSafe(content),
    required,
    locked,
    clientEditable,
    display: cloneFirestoreSafe(display),
  }
}

export function createInternalShowcaseDocumentBlocks(): DocumentBlock[] {
  return [
    createShowcaseDocumentBlock({
      type: 'funnel',
      title: 'Conversion journey snapshot',
      content: {
        eyebrow: 'Growth system',
        headline: 'From attention to retained revenue',
        description: 'A board-ready view of how demand moves through the client growth engine, using neutral example values for internal QA and demos.',
        stages: [
          { id: 'audience', label: 'Audience reached', value: 12000, description: 'Relevant people reached through owned, social, and search touchpoints.', conversionRate: 100 },
          { id: 'engaged', label: 'Engaged prospects', value: 1800, description: 'Prospects who showed intent by clicking, replying, saving, or visiting priority pages.', conversionRate: 15 },
          { id: 'qualified', label: 'Qualified opportunities', value: 360, description: 'Contacts with clear fit, urgency, and a next-step reason.', conversionRate: 20 },
          { id: 'won', label: 'New revenue conversations', value: 72, description: 'Booked calls, proposal requests, or deal-stage opportunities ready for follow-up.', conversionRate: 20 },
        ],
      },
      display: { motion: 'reveal' },
    }),
    createShowcaseDocumentBlock({
      type: 'radar',
      title: 'Capability readiness radar',
      content: {
        eyebrow: 'Operating readiness',
        headline: 'What is strong enough to scale',
        description: 'A quick executive read on the capabilities needed before increasing campaign volume or automation depth.',
        axes: [
          { id: 'positioning', label: 'Positioning clarity', value: 8, max: 10, benchmark: 7 },
          { id: 'proof', label: 'Proof density', value: 6, max: 10, benchmark: 7 },
          { id: 'follow_up', label: 'Follow-up discipline', value: 7, max: 10, benchmark: 8 },
          { id: 'data', label: 'Data hygiene', value: 5, max: 10, benchmark: 7 },
          { id: 'delivery', label: 'Delivery confidence', value: 8, max: 10, benchmark: 7 },
        ],
      },
    }),
    createShowcaseDocumentBlock({
      type: 'quadrant_matrix',
      title: 'Opportunity prioritisation matrix',
      content: {
        eyebrow: 'Focus',
        headline: 'Pick the next moves with impact and confidence',
        description: 'Example initiatives plotted so leadership can see what to ship, defer, or investigate before spend increases.',
        xAxis: { label: 'Confidence', minLabel: 'Unproven', maxLabel: 'Proven' },
        yAxis: { label: 'Growth impact', minLabel: 'Low', maxLabel: 'High' },
        items: [
          { id: 'offer-page', label: 'Offer page refresh', x: 82, y: 88, description: 'Clearer conversion path with existing proof.' },
          { id: 'crm-cleanup', label: 'CRM cleanup', x: 72, y: 66, description: 'Improves routing and reporting reliability.' },
          { id: 'new-channel', label: 'New channel test', x: 38, y: 74, description: 'Promising, but needs controlled evidence.' },
          { id: 'asset-library', label: 'Proof asset library', x: 64, y: 54, description: 'Useful foundation for campaigns and sales.' },
        ],
      },
    }),
    createShowcaseDocumentBlock({
      type: 'before_after',
      title: 'Before and after operating model',
      content: {
        eyebrow: 'Transformation',
        headline: 'What changes when the system is working',
        description: 'Plain-language contrasts that show the operational value of structured campaigns, data, and follow-up.',
        pairs: [
          { id: 'content', label: 'Content planning', before: 'Ad hoc posts depend on whoever has time this week.', after: 'Campaign themes, proof points, and next actions are planned before production starts.', evidence: 'Weekly approvals become faster because decisions are made against a visible plan.' },
          { id: 'leads', label: 'Lead handling', before: 'Enquiries arrive in multiple inboxes with inconsistent follow-up.', after: 'Qualified enquiries route into one workflow with owner, status, and next-step visibility.', evidence: 'Pipeline reviews focus on bottlenecks instead of hunting for context.' },
        ],
      },
    }),
    createShowcaseDocumentBlock({
      type: 'roadmap_gantt',
      title: 'Launch roadmap',
      content: {
        eyebrow: 'Delivery',
        headline: 'A realistic path from decision to live system',
        description: 'A reusable internal example of how strategy, build, content, and QA can be sequenced without over-promising.',
        items: [
          { id: 'discovery', label: 'Decision brief and evidence review', start: '2026-06-01', end: '2026-06-05', lane: 'Strategy', status: 'complete', owner: 'Strategy lead' },
          { id: 'architecture', label: 'Workflow and payload architecture', start: '2026-06-06', end: '2026-06-12', lane: 'Build', status: 'in_progress', owner: 'Engineering', dependsOn: ['discovery'] },
          { id: 'assets', label: 'Message and proof asset pack', start: '2026-06-10', end: '2026-06-18', lane: 'Content', status: 'planned', owner: 'Marketing', dependsOn: ['discovery'] },
          { id: 'qa', label: 'QA, approval, and launch readiness', start: '2026-06-19', end: '2026-06-24', lane: 'Release', status: 'planned', owner: 'QA', dependsOn: ['architecture', 'assets'] },
        ],
        milestones: [
          { id: 'approval', label: 'Internal approval', date: '2026-06-13' },
          { id: 'launch', label: 'Ready to launch', date: '2026-06-25' },
        ],
      },
      display: { motion: 'timeline' },
    }),
    createShowcaseDocumentBlock({
      type: 'logo_testimonial_proof',
      title: 'Proof stack',
      content: {
        eyebrow: 'Trust',
        headline: 'Evidence a buyer can believe quickly',
        description: 'Neutral proof examples that demonstrate layout behaviour without naming real clients or exposing private results.',
        proof: [
          { id: 'credential', kind: 'credential', organisationName: 'Verified operating process', metricLabel: 'Documented delivery standard' },
          { id: 'stat', kind: 'stat', metricValue: '3x', metricLabel: 'More consistent follow-up when ownership, status, and next actions are visible' },
          { id: 'quote', kind: 'testimonial', quote: 'The biggest shift was clarity: everyone could see what was live, what needed approval, and what was blocked.', personName: 'Operations lead', personRole: 'Internal example persona' },
          { id: 'logo', kind: 'logo', organisationName: 'Example client workspace' },
        ],
      },
    }),
    createShowcaseDocumentBlock({
      type: 'case_study_result_cards',
      title: 'Result-card pattern',
      content: {
        eyebrow: 'Outcomes',
        headline: 'Show the result, then the reason it happened',
        description: 'Short cards designed for proposal and report sections where the reader needs proof before detail.',
        cards: [
          { id: 'speed', title: 'Faster approval cycle', result: '48h', narrative: 'Decision-makers reviewed one structured document instead of scattered notes and messages.', baseline: 'Previously one to two weeks', timeframe: 'Internal example' },
          { id: 'pipeline', title: 'Cleaner pipeline view', result: '+31%', narrative: 'More records had owner, source, status, and next action populated after workflow cleanup.', baseline: 'Example baseline only', timeframe: '60-day model' },
          { id: 'content', title: 'More reusable campaign assets', result: '12', narrative: 'Core proof points were converted into modular blocks for web, social, and proposal use.', baseline: 'Ad hoc one-off content', timeframe: 'One campaign cycle' },
        ],
      },
    }),
    createShowcaseDocumentBlock({
      type: 'weighted_decision_matrix',
      title: 'Weighted decision matrix',
      content: {
        eyebrow: 'Decision support',
        headline: 'Compare options without hiding the trade-offs',
        description: 'A transparent scoring model for prioritising the next growth-system investment.',
        criteria: [
          { id: 'impact', label: 'Commercial impact', weight: 0.4, description: 'Likely effect on qualified demand, conversion, or retention.' },
          { id: 'speed', label: 'Speed to value', weight: 0.25, description: 'How quickly the work can produce usable evidence.' },
          { id: 'confidence', label: 'Evidence confidence', weight: 0.2, description: 'How much existing proof supports the bet.' },
          { id: 'load', label: 'Operational load', weight: 0.15, description: 'Lower scores indicate heavier internal complexity.' },
        ],
        options: [
          { id: 'conversion-page', label: 'Conversion page and proof refresh', scores: { impact: 9, speed: 8, confidence: 8, load: 7 }, summary: 'Best balance of impact and evidence.', recommended: true },
          { id: 'crm-automation', label: 'CRM automation cleanup', scores: { impact: 8, speed: 6, confidence: 7, load: 6 }, summary: 'Strong foundation, but needs careful QA.' },
          { id: 'new-channel', label: 'New acquisition channel test', scores: { impact: 7, speed: 5, confidence: 4, load: 5 }, summary: 'Useful later once conversion basics are stronger.' },
        ],
      },
    }),
  ]
}

export function createInternalShowcaseVersionPayload(): InternalShowcaseVersionPayload {
  return {
    blocks: createInternalShowcaseDocumentBlocks(),
    theme: cloneFirestoreSafe(INTERNAL_SHOWCASE_THEME),
    changeSummary: 'Internal showcase example for advanced document blocks',
  }
}
