import type { DocumentBlock } from '@/lib/client-documents/types'
import type { ResearchItem, ResearchSource } from '@/lib/research/types'

const display = { motion: 'reveal' as const }

function block(id: string, type: DocumentBlock['type'], title: string, content: unknown): DocumentBlock {
  return { id, type, title, content, required: true, display: { ...display } }
}

function line(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' | ')
}

export function blocksFromResearchItem(item: ResearchItem, sources: ResearchSource[]): DocumentBlock[] {
  const findings = item.findings.map((finding) =>
    [
      finding.title,
      finding.body,
      line([
        `Confidence: ${finding.confidence}`,
        `Status: ${finding.status}`,
        finding.sourceIds.length ? `Sources: ${finding.sourceIds.join(', ')}` : false,
      ]),
    ].filter(Boolean).join('\n'),
  )
  const recommendations = item.recommendations.map((recommendation) =>
    [
      recommendation.title,
      recommendation.body,
      line([
        `Priority: ${recommendation.priority}`,
        `Status: ${recommendation.status}`,
        recommendation.sourceIds.length ? `Sources: ${recommendation.sourceIds.join(', ')}` : false,
      ]),
    ].filter(Boolean).join('\n'),
  )

  return [
    block('hero', 'hero', item.title, item.summary || `${item.kind} research report`),
    block('summary', 'summary', 'Research summary', [
      item.summary,
      item.tags.length ? `Tags: ${item.tags.join(', ')}` : '',
      `Kind: ${item.kind}`,
      `Status: ${item.status}`,
      `Visibility: ${item.visibility}`,
    ].filter(Boolean).join('\n\n')),
    block('findings', 'deliverables', 'Key findings', findings.length ? findings : ['No findings captured yet.']),
    block('sources', 'table', 'Evidence and sources', {
      headers: ['Source', 'Type', 'Confidence', 'Verified', 'Excerpt / URL'],
      rows: sources.map((source) => [
        source.title,
        source.type,
        source.confidence,
        source.verified ? 'Yes' : 'No',
        source.excerpt ?? source.rawText ?? source.url ?? source.mediaUrl ?? '',
      ]),
    }),
    block('recommendations', 'callout', 'Recommendations', {
      title: recommendations.length ? 'Recommended actions' : 'No recommendations captured yet',
      body: recommendations.join('\n\n'),
      variant: 'success',
    }),
    block('next_steps', 'scope', 'Next steps', [
      'Review open comments and disputed findings.',
      'Confirm which recommendations should move into execution.',
      'Use this research as source material for linked campaigns, SEO work, CRM follow-up, or strategy documents.',
    ]),
    block('approval', 'approval', 'Acknowledgement', 'Acknowledgement confirms this research has been reviewed and can be used as input for planning, campaigns, reports, or implementation work.'),
  ]
}
