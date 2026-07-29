import { extractMixedRichContent } from '@/lib/hermes/rich-messages'

describe('extractMixedRichContent', () => {
  const approvalEnvelope = {
    rich_parts: [{
      type: 'approval_card',
      title: 'Approve Isaac’s Bark.com follow-up sequence',
      body: 'The Isaac lead is ready.',
      statusLabel: 'Needs approval before sending',
      evidence: ['CRM contact created'],
      decisions: [{ label: 'Approve activation', required: true }],
      recommendation: 'Keep draft until consent is confirmed.',
    }],
  }

  it('parses a pure rich_parts JSON envelope', () => {
    const result = extractMixedRichContent(JSON.stringify(approvalEnvelope))
    expect(result.extracted).toBe(true)
    expect(result.prose).toBe('')
    expect(result.richParts[0]).toMatchObject({
      type: 'approval_card',
      title: 'Approve Isaac’s Bark.com follow-up sequence',
    })
  })

  it('extracts a trailing rich_parts blob after prose (agent dump pattern)', () => {
    const prose = [
      'Bark — Isaac restaurant website follow-up',
      'Status: Draft',
      '',
      'Four high-priority CRM tasks were also created.',
      'No email was sent. Human approval is required.',
    ].join('\n')
    const mixed = `${prose}\n\n${JSON.stringify(approvalEnvelope)}`
    const result = extractMixedRichContent(mixed)
    expect(result.extracted).toBe(true)
    expect(result.prose).toContain('Bark — Isaac restaurant website follow-up')
    expect(result.prose).toContain('Human approval is required')
    expect(result.prose).not.toContain('rich_parts')
    expect(result.prose).not.toContain('approval_card')
    expect(result.richParts).toHaveLength(1)
    expect(result.richParts[0]).toMatchObject({
      type: 'approval_card',
      statusLabel: 'Needs approval before sending',
    })
  })

  it('extracts a trailing fenced json block', () => {
    const mixed = `Summary ready.\n\n\`\`\`json\n${JSON.stringify(approvalEnvelope)}\n\`\`\``
    const result = extractMixedRichContent(mixed)
    expect(result.extracted).toBe(true)
    expect(result.prose).toBe('Summary ready.')
    expect(result.richParts[0]?.type).toBe('approval_card')
  })

  it('leaves ordinary prose alone', () => {
    const result = extractMixedRichContent('Just a normal agent reply with no structure.')
    expect(result.extracted).toBe(false)
    expect(result.prose).toBe('Just a normal agent reply with no structure.')
    expect(result.richParts).toEqual([])
  })
})
