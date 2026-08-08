import type { ResearchItem, ResearchSource } from '@/lib/research/types'

function list(values: string[] | undefined) {
  return values?.length ? values.join(', ') : 'none'
}

function linkedLines(item: ResearchItem) {
  const linked = item.linked ?? {}
  return Object.entries(linked)
    .filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value))
    .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
}

export function renderResearchMarkdown(item: ResearchItem, sources: ResearchSource[] = []) {
  const designContextLines = item.designContext ? renderDesignContextMarkdown(item.designContext) : []
  const lines = [
    `# ${item.title}`,
    '',
    `Kind: ${item.kind}`,
    `Status: ${item.status}`,
    `Visibility: ${item.visibility}`,
    `Tags: ${list(item.tags)}`,
    '',
    '## Summary',
    item.summary || '_No summary captured yet._',
    '',
    ...(designContextLines.length > 0 ? ['## Design Context', ...designContextLines, ''] : []),
    '## Linked Records',
    ...(linkedLines(item).length ? linkedLines(item) : ['- none']),
    '',
    '## Findings',
    ...(item.findings.length ? item.findings.flatMap((finding) => [
      `### ${finding.title}`,
      `- Confidence: ${finding.confidence}`,
      `- Status: ${finding.status}`,
      `- Sources: ${list(finding.sourceIds.map((id) => `[${id}]`))}`,
      '',
      finding.body || '_No detail captured._',
      '',
    ]) : ['_No findings captured yet._', '']),
    '## Recommendations',
    ...(item.recommendations.length ? item.recommendations.flatMap((recommendation) => [
      `### ${recommendation.title}`,
      `- Priority: ${recommendation.priority}`,
      `- Status: ${recommendation.status}`,
      `- Sources: ${list(recommendation.sourceIds.map((id) => `[${id}]`))}`,
      '',
      recommendation.body || '_No detail captured._',
      '',
    ]) : ['_No recommendations captured yet._', '']),
    '## Source Index',
    ...(sources.length ? sources.map((source) => `- [${source.id}] ${source.title}${source.url ? ` — ${source.url}` : ''}`) : ['- none']),
    '',
    '## Working Notes',
    item.notesMarkdown || '_No working notes captured yet._',
    '',
  ]
  return lines.join('\n')
}

function renderDesignContextMarkdown(record: import('@/lib/research/design-context').DesignContextRecord): string[] {
  const lines = [
    `- Version: ${record.version}`,
    `- Source: ${record.source}${record.sourceUrl ? ` — ${record.sourceUrl}` : ''}`,
  ]
  if (record.audience) lines.push(`- Audience: ${record.audience}`)
  if (record.positioning) lines.push(`- Positioning: ${record.positioning}`)
  if (record.brandVoice) lines.push(`- Brand voice: ${record.brandVoice}`)
  if (record.antiReferences.length) lines.push(`- Anti-references: ${record.antiReferences.join('; ')}`)
  if (record.palette.length) lines.push(`- Palette: ${record.palette.map((color) => `${color.name} ${color.value}${color.usage ? ` (${color.usage})` : ''}`).join(' | ')}`)
  if (record.typeStack.length) lines.push(`- Type stack: ${record.typeStack.map((type) => `${type.role} ${type.family}${type.scale ? ` (${type.scale})` : ''}`).join(' | ')}`)
  if (record.componentRules.length) lines.push(`- Component rules: ${record.componentRules.join('; ')}`)
  if (record.radiusScale.length) lines.push(`- Radius scale: ${record.radiusScale.map((token) => `${token.name}=${token.value}`).join(' | ')}`)
  if (record.elevationScale.length) lines.push(`- Elevation scale: ${record.elevationScale.map((token) => `${token.name}=${token.value}`).join(' | ')}`)
  if (record.surfaceModes.length) lines.push(`- Surface modes: ${record.surfaceModes.map((mode) => `${mode.surface} → ${mode.mode}`).join(' | ')}`)
  return lines
}

export function renderResearchSourcesMarkdown(item: ResearchItem, sources: ResearchSource[] = []) {
  return [
    `# Sources: ${item.title}`,
    '',
    ...(sources.length ? sources.flatMap((source) => [
      `## ${source.title}`,
      `- ID: ${source.id}`,
      `- Type: ${source.type}`,
      `- Confidence: ${source.confidence}`,
      `- Verified: ${source.verified ? 'yes' : 'no'}`,
      ...(source.publisher ? [`- Publisher: ${source.publisher}`] : []),
      ...(source.sourceDate ? [`- Source date: ${source.sourceDate}`] : []),
      ...(source.url ? [`- URL: ${source.url}`] : []),
      '',
      source.excerpt || source.rawText || '_No excerpt captured._',
      '',
    ]) : ['_No sources captured yet._', '']),
  ].join('\n')
}
