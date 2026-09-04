import { PART_LIMITS, validatePart } from '@/lib/chat/parts'
import { extractPibFences } from '@/lib/chat/pib-fences'

describe('validatePart', () => {
  it('rejects oversized charts', () => {
    const data = Array.from({ length: PART_LIMITS.chartRows + 1 }, (_, index) => ({ x: index }))
    expect(validatePart({ type: 'chart', x: 'x', series: [{ key: 'y' }], data }).ok).toBe(false)
  })

  it('rejects empty mermaid', () => {
    expect(validatePart({ type: 'mermaid', source: '' }).ok).toBe(false)
  })

  it('rejects oversized math', () => {
    expect(validatePart({ type: 'math', latex: 'x'.repeat(PART_LIMITS.mathChars + 1) }).ok).toBe(false)
  })

  it('rejects html artifacts without a title', () => {
    expect(validatePart({ type: 'html_artifact', html: '<p>hi</p>' }).ok).toBe(false)
  })

  it('rejects files without a url', () => {
    expect(validatePart({ type: 'file', name: 'a.csv' }).ok).toBe(false)
  })
})

describe('extractPibFences', () => {
  it('extracts a chart fence and leaves a placeholder', () => {
    const result = extractPibFences('See\n```pib:chart\n{"kind":"bar","x":"m","series":[{"key":"v"}],"data":[{"m":"Jan","v":1}]}\n```\n')
    expect(result.parts[0]).toMatchObject({ type: 'chart', kind: 'bar' })
    expect(result.markdown).toContain('<!--pib-part:0-->')
  })

  it('leaves malformed chart JSON untouched', () => {
    const raw = '```pib:chart\n{not-json\n```'
    const result = extractPibFences(raw)
    expect(result.parts).toEqual([])
    expect(result.markdown).toContain('pib:chart')
  })

  it('maps mermaid fences', () => {
    const result = extractPibFences('```mermaid\ngraph TD; A-->B;\n```')
    expect(result.parts[0]).toMatchObject({ type: 'mermaid' })
  })

  it('returns unchanged markdown when there are no fences', () => {
    expect(extractPibFences('hello')).toEqual({ markdown: 'hello', parts: [] })
  })
})
