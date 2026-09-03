import { sanitizeInlineSvg } from '@/lib/chat/sanitize-svg'

describe('sanitizeInlineSvg', () => {
  it('keeps a plain svg element', () => {
    const svg = '<svg width="10" height="10"><rect width="10" height="10"/></svg>'
    expect(sanitizeInlineSvg(svg)).toBe(svg)
  })

  it('rejects script and event handlers', () => {
    expect(sanitizeInlineSvg('<svg><script>alert(1)</script></svg>')).toBeNull()
    expect(sanitizeInlineSvg('<svg onload="alert(1)"></svg>')).toBeNull()
    expect(sanitizeInlineSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBeNull()
  })
})
