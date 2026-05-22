import type { DocumentBlock } from '@/lib/client-documents/types'
import type { ResearchItem, ResearchSource } from '@/lib/research/types'

const display = { motion: 'reveal' as const }

function block(id: string, type: DocumentBlock['type'], title: string, content: unknown): DocumentBlock {
  return { id, type, title, content, required: true, display: { ...display } }
}

export function blocksFromResearchItem(item: ResearchItem, sources: ResearchSource[]): DocumentBlock[] {
  return [
    block('hero', 'hero', item.title, {
      eyebrow: 'Research Report',
      subtitle: item.summary,
      meta: [item.kind, item.status, item.visibility],
    }),
    block('summary', 'summary', 'Research summary', {
      summary: item.summary,
      tags: item.tags,
      linked: item.linked,
    }),
    block('findings', 'deliverables', 'Key findings', item.findings.map((finding) => ({
      title: finding.title,
      body: finding.body,
      confidence: finding.confidence,
      status: finding.status,
      sources: finding.sourceIds,
    }))),
    block('sources', 'gallery', 'Evidence and sources', sources.map((source) => ({
      title: source.title,
      body: source.excerpt ?? source.rawText ?? source.url ?? '',
      url: source.url,
      mediaUrl: source.mediaUrl,
      type: source.type,
      confidence: source.confidence,
      verified: source.verified,
    }))),
    block('recommendations', 'callout', 'Recommendations', item.recommendations.map((recommendation) => ({
      title: recommendation.title,
      body: recommendation.body,
      priority: recommendation.priority,
      status: recommendation.status,
      sources: recommendation.sourceIds,
    }))),
    block('next_steps', 'scope', 'Next steps', [
      'Review open comments and disputed findings.',
      'Confirm which recommendations should move into execution.',
      'Use this research as source material for linked campaigns, SEO work, CRM follow-up, or strategy documents.',
    ]),
    block('approval', 'approval', 'Acknowledgement', 'Acknowledgement confirms this research has been reviewed and can be used as input for planning, campaigns, reports, or implementation work.'),
  ]
}
