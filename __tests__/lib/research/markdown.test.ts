import type { ResearchItem, ResearchSource } from '@/lib/research/types'
import { renderResearchMarkdown, renderResearchSourcesMarkdown } from '@/lib/research/markdown'

const item: ResearchItem = {
  id: 'research-1',
  orgId: 'org-1',
  title: 'Competitor positioning audit',
  slug: 'competitor-positioning-audit',
  kind: 'competitor',
  status: 'verified',
  visibility: 'client_visible',
  summary: 'A concise summary of the research.',
  notesMarkdown: 'Internal notes that should remain useful to agents.',
  tags: ['competitors', 'positioning'],
  linked: { projectId: 'project-1', documentIds: ['doc-1'] },
  findings: [
    {
      id: 'finding-1',
      title: 'Competitor leads with speed',
      body: 'Their headline focuses on same-day turnaround.',
      confidence: 'high',
      status: 'verified',
      sourceIds: ['source-1'],
      tags: ['message'],
    },
  ],
  recommendations: [
    {
      id: 'recommendation-1',
      title: 'Own implementation quality',
      body: 'Position PiB around correctness and proof, not speed alone.',
      priority: 'high',
      status: 'open',
      sourceIds: ['source-1'],
    },
  ],
  obsidian: { exported: false },
  createdBy: 'admin-1',
  updatedBy: 'admin-1',
  deleted: false,
}

const sources: ResearchSource[] = [
  {
    id: 'source-1',
    researchItemId: 'research-1',
    type: 'url',
    title: 'Competitor home page',
    url: 'https://example.com',
    excerpt: 'Same-day turnaround for growing teams.',
    publisher: 'Example',
    confidence: 'high',
    verified: true,
    createdBy: 'admin-1',
    updatedBy: 'admin-1',
    deleted: false,
  },
]

describe('research markdown export', () => {
  it('renders a durable agent summary with findings, recommendations, links, and source references', () => {
    expect(renderResearchMarkdown(item, sources)).toContain('# Competitor positioning audit')
    expect(renderResearchMarkdown(item, sources)).toContain('Status: verified')
    expect(renderResearchMarkdown(item, sources)).toContain('## Findings')
    expect(renderResearchMarkdown(item, sources)).toContain('Competitor leads with speed')
    expect(renderResearchMarkdown(item, sources)).toContain('## Recommendations')
    expect(renderResearchMarkdown(item, sources)).toContain('Own implementation quality')
    expect(renderResearchMarkdown(item, sources)).toContain('projectId: project-1')
    expect(renderResearchMarkdown(item, sources)).toContain('[source-1]')
  })

  it('renders source evidence separately for the raw Obsidian section', () => {
    const markdown = renderResearchSourcesMarkdown(item, sources)

    expect(markdown).toContain('# Sources: Competitor positioning audit')
    expect(markdown).toContain('## Competitor home page')
    expect(markdown).toContain('https://example.com')
    expect(markdown).toContain('Same-day turnaround')
  })
})
