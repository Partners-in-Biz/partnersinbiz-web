import {
  chunkMemoryText,
  hashMemorySource,
  memoryDocId,
  normalizeLookupText,
  sourceToChunkTexts,
} from '@/lib/agent-memory/text'

describe('agent memory text helpers', () => {
  it('normalizes lookup text by removing common request filler', () => {
    expect(normalizeLookupText('Get me the client called John Smith please')).toBe('john smith')
    expect(normalizeLookupText('  Find contact: JANE@example.com  ')).toBe('jane example com')
  })

  it('chunks long source text without dropping metadata context', () => {
    const long = Array.from({ length: 180 }, (_, index) => `sentence ${index + 1}`).join('. ')

    const chunks = chunkMemoryText(long, { maxChars: 260, overlapChars: 50 })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 320)).toBe(true)
    expect(chunks[1]).toContain('sentence')
  })

  it('builds deterministic source hashes and chunk document ids', () => {
    const source = {
      orgId: 'org-1',
      sourceType: 'research_item' as const,
      sourceId: 'abc',
      title: 'Finding',
      text: 'Important evidence',
      metadata: { kept: true },
    }

    expect(hashMemorySource(source)).toBe(hashMemorySource({ ...source }))
    expect(memoryDocId(source, 0)).toBe('org-1__research_item__abc__0')
  })

  it('converts a source into indexable chunk text with title and summary', () => {
    const chunks = sourceToChunkTexts({
      orgId: 'org-1',
      sourceType: 'company',
      sourceId: 'company-1',
      title: 'John Plumbing',
      summary: 'CRM company',
      text: 'Pretoria plumbing client with urgent website work.',
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toContain('John Plumbing')
    expect(chunks[0].text).toContain('CRM company')
    expect(chunks[0].text).toContain('Pretoria plumbing client')
  })
})
