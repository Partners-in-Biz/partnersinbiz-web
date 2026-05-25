import {
  CANONICAL_DOCUMENT_BLOCK_TYPES,
  CANONICAL_SHOWCASE_BLOCK_CONTRACTS,
  type BeforeAfterBlockContent,
  type CaseStudyResultCardsBlockContent,
  type DocumentBlock,
  type FunnelBlockContent,
  type LogoTestimonialProofBlockContent,
  type QuadrantMatrixBlockContent,
  type RadarBlockContent,
  type RoadmapGanttBlockContent,
  type WeightedDecisionMatrixBlockContent,
} from '@/lib/client-documents/types'

describe('client document showcase block contracts', () => {
  it('defines canonical payload contracts for every approved show-off block', () => {
    expect(Object.keys(CANONICAL_SHOWCASE_BLOCK_CONTRACTS)).toEqual([
      'funnel',
      'radar',
      'quadrant_matrix',
      'before_after',
      'roadmap_gantt',
      'logo_testimonial_proof',
      'case_study_result_cards',
      'weighted_decision_matrix',
    ])

    expect(CANONICAL_SHOWCASE_BLOCK_CONTRACTS.funnel).toMatchObject({
      type: 'funnel',
      payloadKey: 'stages',
      requiredFields: ['stages'],
      backwardCompatible: true,
    })
    expect(CANONICAL_SHOWCASE_BLOCK_CONTRACTS.radar).toMatchObject({
      type: 'radar',
      payloadKey: 'axes',
      requiredFields: ['axes'],
      backwardCompatible: true,
    })
    expect(CANONICAL_SHOWCASE_BLOCK_CONTRACTS.quadrant_matrix).toMatchObject({
      type: 'quadrant_matrix',
      payloadKey: 'items',
      requiredFields: ['xAxis', 'yAxis', 'items'],
      backwardCompatible: true,
    })
    expect(CANONICAL_SHOWCASE_BLOCK_CONTRACTS.before_after).toMatchObject({
      type: 'before_after',
      payloadKey: 'pairs',
      requiredFields: ['pairs'],
      backwardCompatible: true,
    })
    expect(CANONICAL_SHOWCASE_BLOCK_CONTRACTS.roadmap_gantt).toMatchObject({
      type: 'roadmap_gantt',
      payloadKey: 'items',
      requiredFields: ['items'],
      backwardCompatible: true,
    })
    expect(CANONICAL_SHOWCASE_BLOCK_CONTRACTS.logo_testimonial_proof).toMatchObject({
      type: 'logo_testimonial_proof',
      payloadKey: 'proof',
      requiredFields: ['proof'],
      backwardCompatible: true,
    })
    expect(CANONICAL_SHOWCASE_BLOCK_CONTRACTS.case_study_result_cards).toMatchObject({
      type: 'case_study_result_cards',
      payloadKey: 'cards',
      requiredFields: ['cards'],
      backwardCompatible: true,
    })
    expect(CANONICAL_SHOWCASE_BLOCK_CONTRACTS.weighted_decision_matrix).toMatchObject({
      type: 'weighted_decision_matrix',
      payloadKey: 'criteria',
      requiredFields: ['criteria', 'options'],
      backwardCompatible: true,
    })
  })

  it('keeps all existing renderer block types while appending new showcase types', () => {
    expect(CANONICAL_DOCUMENT_BLOCK_TYPES.slice(0, 23)).toEqual([
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
    ])
    expect(CANONICAL_DOCUMENT_BLOCK_TYPES.slice(23)).toEqual(Object.keys(CANONICAL_SHOWCASE_BLOCK_CONTRACTS))
  })

  it('supports strongly typed payload examples without narrowing legacy content', () => {
    const funnel: FunnelBlockContent = {
      stages: [{ id: 'aware', label: 'Aware', value: 100, description: 'Top of funnel' }],
    }
    const radar: RadarBlockContent = {
      axes: [{ id: 'speed', label: 'Speed', value: 4, max: 5 }],
    }
    const matrix: QuadrantMatrixBlockContent = {
      xAxis: { label: 'Effort', minLabel: 'Low', maxLabel: 'High' },
      yAxis: { label: 'Impact', minLabel: 'Low', maxLabel: 'High' },
      items: [{ id: 'seo', label: 'SEO', x: 0.4, y: 0.8 }],
    }
    const beforeAfter: BeforeAfterBlockContent = {
      pairs: [{ id: 'messaging', label: 'Messaging', before: 'Generic', after: 'Outcome-led' }],
    }
    const roadmap: RoadmapGanttBlockContent = {
      items: [{ id: 'phase-1', label: 'Phase 1', start: '2026-06-01', end: '2026-06-14' }],
    }
    const proof: LogoTestimonialProofBlockContent = {
      proof: [{ id: 'client', kind: 'testimonial', quote: 'Clear and fast.', personName: 'A Client' }],
    }
    const cards: CaseStudyResultCardsBlockContent = {
      cards: [{ id: 'case', title: 'Pipeline lift', result: '+32%', narrative: 'More qualified enquiries.' }],
    }
    const decision: WeightedDecisionMatrixBlockContent = {
      criteria: [{ id: 'impact', label: 'Impact', weight: 0.7 }],
      options: [{ id: 'option-a', label: 'Option A', scores: { impact: 5 } }],
    }
    const legacy: DocumentBlock = {
      id: 'legacy-summary',
      type: 'summary',
      content: { anyExistingShape: true },
      required: false,
      display: {},
    }

    expect({ funnel, radar, matrix, beforeAfter, roadmap, proof, cards, decision, legacy }).toBeTruthy()
  })
})
