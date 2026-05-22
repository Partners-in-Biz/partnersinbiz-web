import type { ResearchItem, ResearchSource } from '@/lib/research/types'
import { blocksFromResearchItem } from '@/lib/research/document'

const item: ResearchItem = {
  id: 'research-1',
  orgId: 'org-1',
  title: 'Audience question research',
  slug: 'audience-question-research',
  kind: 'audience',
  status: 'verified',
  visibility: 'client_visible',
  summary: 'The audience repeatedly asks implementation-risk questions.',
  notesMarkdown: '',
  tags: ['audience'],
  linked: {},
  findings: [{ id: 'f1', title: 'Risk questions dominate', body: 'People ask about failed handovers.', confidence: 'high', status: 'verified', sourceIds: ['s1'], tags: [] }],
  recommendations: [{ id: 'r1', title: 'Publish proof-led explainers', body: 'Answer the risk objections directly.', priority: 'high', status: 'open', sourceIds: ['s1'] }],
  obsidian: { exported: false },
  createdBy: 'admin-1',
  updatedBy: 'admin-1',
  deleted: false,
}

const sources: ResearchSource[] = [
  { id: 's1', researchItemId: 'research-1', type: 'url', title: 'Forum thread', url: 'https://example.com/thread', confidence: 'medium', verified: true, createdBy: 'admin-1', updatedBy: 'admin-1', deleted: false },
]

describe('research report document blocks', () => {
  it('turns research into client-document blocks with findings, sources, recommendations, and next steps', () => {
    const blocks = blocksFromResearchItem(item, sources)

    expect(blocks.map((block) => block.id)).toEqual([
      'hero',
      'summary',
      'findings',
      'sources',
      'recommendations',
      'next_steps',
      'approval',
    ])
    expect(blocks[2].type).toBe('deliverables')
    expect(JSON.stringify(blocks)).toContain('Risk questions dominate')
    expect(JSON.stringify(blocks)).toContain('Forum thread')
    expect(JSON.stringify(blocks)).toContain('Publish proof-led explainers')
  })
})
