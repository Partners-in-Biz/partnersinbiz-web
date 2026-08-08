import {
  looksLikeHtml,
  extractHtmlPayloads,
  auditStudioNode,
  buildStudioStamp,
} from '../../../lib/design-audit/studio'

describe('Studio artifact gate', () => {
  it('detects HTML-like strings', () => {
    expect(looksLikeHtml('<div>Hello</div>')).toBe(true)
    expect(looksLikeHtml('<p>Hello world</p>')).toBe(true)
    expect(looksLikeHtml('Plain text without tags')).toBe(false)
    expect(looksLikeHtml('short')).toBe(false)
    expect(looksLikeHtml('')).toBe(false)
  })

  it('extracts HTML payloads from node data top-level fields', () => {
    const payloads = extractHtmlPayloads({
      html: '<div><p>Hi</p></div>',
      bodyHtml: '<section>Body</section>',
      textPreview: '<p>Preview</p>',
      title: 'Not html',
      count: 3,
    })
    expect(payloads.map((p) => p.field).sort()).toEqual(['bodyHtml', 'html', 'textPreview'])
    expect(payloads.every((p) => looksLikeHtml(p.html))).toBe(true)
  })

  it('extracts nested and array HTML payloads', () => {
    const payloads = extractHtmlPayloads({
      blocks: [
        { content: '<p>Block one</p>' },
        'plain string',
        { inner: { html: '<div>Deep</div>' } },
      ],
    })
    const fields = payloads.map((p) => p.field)
    expect(fields).toContain('blocks.content')
    expect(fields).toContain('blocks.inner.html')
    expect(fields.length).toBeGreaterThanOrEqual(2)
  })

  it('ignores bounded oversized values and non-markup', () => {
    const payloads = extractHtmlPayloads({
      html: '<div>' + 'x'.repeat(250_000) + '</div>',
      note: 'no tags here',
    })
    expect(payloads).toEqual([])
  })

  it('runs the detector and reports blocked P0/P1 findings', () => {
    const { findings, summary } = auditStudioNode('node-1', {
      html: '<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"><p>Copy — dashed.</p></div>',
    })
    expect(summary.findings).toBeGreaterThan(0)
    expect(summary.blocked).toBeGreaterThan(0)
    expect(findings.some((f) => f.rule === 'purple-gradients' && f.field === 'html')).toBe(true)
  })

  it('builds a stamp only when findings exist; null when clean', () => {
    const dirty = buildStudioStamp('node-1', {
      html: '<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>',
    })
    expect(dirty.stamp).not.toBeNull()
    expect(dirty.stamp!.mode).toBe('studio')
    expect(dirty.stamp!.findings.length).toBeGreaterThan(0)
    expect(typeof dirty.stamp!.at).toBe('string')

    const clean = buildStudioStamp('node-2', {
      html: '<html lang="en"><body><h1>Clean</h1><p>Ok.</p></body></html>',
    })
    expect(clean.stamp).toBeNull()
    expect(clean.findings).toEqual([])
  })

  it('caps stamp findings and honors inline ignores', () => {
    const stamped = buildStudioStamp('node-1', {
      html: '<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"><div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div></div>',
    })
    expect(stamped.stamp!.findings.length).toBeLessThanOrEqual(50)

    const ignored = buildStudioStamp('node-2', {
      html: '<!-- impeccable-disable purple-gradients -->\n<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>',
    })
    expect(ignored.stamp).toBeNull()
  })
})
