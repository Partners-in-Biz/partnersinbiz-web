import type { DocumentBlock } from '@/lib/client-documents/types'
import type { ResearchConfidence, ResearchItem, ResearchSource } from '@/lib/research/types'

const display = { motion: 'reveal' as const }

type BlockDisplay = DocumentBlock['display']

function block(
  id: string,
  type: DocumentBlock['type'],
  title: string,
  content: unknown,
  displayOverride: BlockDisplay = display,
): DocumentBlock {
  return { id, type, title, content, required: true, display: { ...displayOverride } }
}

function line(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' | ')
}

function sourceLabel(sourceIds: string[]) {
  return sourceIds.length ? `Sources: ${sourceIds.join(', ')}` : 'Sources: not linked'
}

function extractMarkdownSection(markdown: string, headings: string[]): string | null {
  if (!markdown.trim()) return null
  const escaped = headings.map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp(`(?:^|\\n)#{1,4}\\s*(?:${escaped})\\s*\\n([\\s\\S]*?)(?=\\n#{1,4}\\s+|$)`, 'i')
  const match = markdown.match(pattern)
  const value = match?.[1]?.trim()
  return value || null
}

function fallbackResearchQuestion(item: ResearchItem) {
  return item.title.endsWith('?') ? item.title : `What should we learn or decide from ${item.title}?`
}

function confidenceScore(confidence: ResearchConfidence) {
  if (confidence === 'high') return '85'
  if (confidence === 'medium') return '60'
  return '35'
}

function overallConfidence(item: ResearchItem, sources: ResearchSource[]): ResearchConfidence {
  const values: ResearchConfidence[] = [
    ...item.findings.map((finding) => finding.confidence),
    ...sources.map((source) => source.confidence),
  ]
  if (!values.length) return 'low'
  if (values.includes('low')) return 'low'
  if (values.includes('medium')) return 'medium'
  return 'high'
}

function formatFindings(item: ResearchItem) {
  return item.findings.map((finding) =>
    [
      finding.title,
      finding.body,
      line([
        `Confidence: ${finding.confidence}`,
        `Status: ${finding.status}`,
        sourceLabel(finding.sourceIds),
      ]),
    ].filter(Boolean).join('\n'),
  )
}

function formatRecommendations(item: ResearchItem) {
  return item.recommendations.map((recommendation) =>
    [
      recommendation.title,
      recommendation.body,
      line([
        `Priority: ${recommendation.priority}`,
        `Status: ${recommendation.status}`,
        sourceLabel(recommendation.sourceIds),
      ]),
    ].filter(Boolean).join('\n'),
  )
}

function sourceRows(sources: ResearchSource[]) {
  return sources.map((source) => [
    source.id,
    source.title,
    source.type,
    source.publisher ?? '',
    source.sourceDate ?? '',
    source.confidence,
    source.verified ? 'Yes' : 'No',
    source.url ?? source.mediaUrl ?? '',
  ])
}

function appendixRows(sources: ResearchSource[]) {
  return sources.map((source) => [
    source.id,
    source.title,
    source.excerpt ?? source.rawText ?? source.url ?? source.mediaUrl ?? 'No excerpt captured.',
  ])
}

function contradictionsAndUnknowns(item: ResearchItem, sources: ResearchSource[]) {
  const disputedFindings = item.findings
    .filter((finding) => finding.status === 'disputed' || finding.status === 'outdated' || finding.confidence === 'low')
    .map((finding) => `${finding.title}: ${finding.status}, ${finding.confidence} confidence`)
  const unverifiedSources = sources
    .filter((source) => !source.verified || source.confidence === 'low')
    .map((source) => `${source.title}: ${source.verified ? 'verified' : 'unverified'}, ${source.confidence} confidence`)
  const explicitUnknowns = extractMarkdownSection(item.notesMarkdown, ['Contradictions / unknowns', 'Contradictions and unknowns', 'Unknowns', 'Risks'])

  const entries = [
    ...(explicitUnknowns ? [explicitUnknowns] : []),
    ...disputedFindings,
    ...unverifiedSources,
  ]
  return entries.length ? entries : ['No contradictions or unknowns have been captured yet.']
}

export function blocksFromResearchItem(item: ResearchItem, sources: ResearchSource[]): DocumentBlock[] {
  const findings = formatFindings(item)
  const recommendations = formatRecommendations(item)
  const confidence = overallConfidence(item, sources)
  const unverifiedSourceCount = sources.filter((source) => !source.verified).length
  const explicitQuestion = extractMarkdownSection(item.notesMarkdown, ['Research question', 'Question'])
  const explicitContext = extractMarkdownSection(item.notesMarkdown, ['Context / hypothesis', 'Context and hypothesis', 'Hypothesis', 'Context'])
  const explicitMethodology = extractMarkdownSection(item.notesMarkdown, ['Methodology', 'Method'])
  const explicitDecision = extractMarkdownSection(item.notesMarkdown, ['Decision needed', 'Decision', 'Approval needed'])

  return [
    block('research_question', 'summary', 'Research question', explicitQuestion ?? fallbackResearchQuestion(item)),
    block('context_hypothesis', 'problem', 'Context / hypothesis', [
      explicitContext ?? item.summary,
      item.tags.length ? `Tags: ${item.tags.join(', ')}` : '',
      line([`Kind: ${item.kind}`, `Status: ${item.status}`, `Visibility: ${item.visibility}`]),
    ].filter(Boolean).join('\n\n')),
    block('methodology', 'rich_text', 'Methodology', explicitMethodology ?? [
      `Reviewed ${sources.length} source${sources.length === 1 ? '' : 's'} linked to the research item.`,
      `Synthesised ${item.findings.length} finding${item.findings.length === 1 ? '' : 's'} and ${item.recommendations.length} recommendation${item.recommendations.length === 1 ? '' : 's'}.`,
      'Evidence is preserved in the source ledger and appendix below; unsupported claims should remain marked as unknown.',
    ].join('\n\n')),
    block('source_ledger', 'table', 'Source ledger', {
      headers: ['ID', 'Source', 'Type', 'Publisher', 'Date', 'Confidence', 'Verified', 'URL / media'],
      rows: sourceRows(sources),
    }),
    block('findings', 'deliverables', 'Findings', findings.length ? findings : ['No findings captured yet.']),
    block('confidence', 'metrics', 'Confidence', {
      items: [
        { label: 'Overall confidence', value: '0', target: confidenceScore(confidence), description: `${confidence} confidence based on captured findings and sources` },
        { label: 'Verified sources', value: '0', target: String(sources.filter((source) => source.verified).length), description: `${sources.length} total source${sources.length === 1 ? '' : 's'}` },
        { label: 'Open evidence gaps', value: '0', target: String(unverifiedSourceCount), description: 'Unverified or weak sources still needing review' },
      ],
    }, { motion: 'counter' }),
    block('contradictions_unknowns', 'risk', 'Contradictions / unknowns', contradictionsAndUnknowns(item, sources)),
    block('recommendations', 'callout', 'Recommendations', {
      title: recommendations.length ? 'Recommended actions' : 'No recommendations captured yet',
      body: recommendations.length ? recommendations.join('\n\n') : 'Capture recommendations before this report is used for planning or execution.',
      variant: recommendations.length ? 'success' : 'warning',
    }),
    block('evidence_appendix', 'table', 'Evidence appendix', {
      headers: ['Source ID', 'Source', 'Evidence excerpt'],
      rows: appendixRows(sources),
    }),
    block('decision_needed', 'approval', 'Decision needed', explicitDecision ?? 'Decide whether this research should remain as decision support, be revised with more evidence, or be converted into a separate approved specification/change request before implementation tasks are created.'),
  ]
}
