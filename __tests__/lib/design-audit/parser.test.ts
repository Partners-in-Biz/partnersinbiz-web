import { parseHtml, pathOf, textContent, walk, countNewlines, parseStyle, decodeEntities } from '@/lib/design-audit/parser'

describe('design-audit parser', () => {
  it('parses a simple document tree with classes, style and text', () => {
    const doc = parseHtml('<html><body><div class="card" style="padding: 4px; color: #fff">Hello</div></body></html>')
    const div = doc.root.children[0].children[0].children[0]
    expect(div.tag).toBe('div')
    expect(div.classes).toEqual(['card'])
    expect(div.style['padding']).toBe('4px')
    expect(div.style['color']).toBe('#fff')
    expect(textContent(div)).toContain('Hello')
  })

  it('records comments with line numbers', () => {
    const doc = parseHtml('<!-- impeccable-disable purple-gradients -->\n<div></div>')
    expect(doc.comments).toHaveLength(1)
    expect(doc.comments[0].text).toContain('impeccable-disable')
    expect(doc.comments[0].line).toBe(1)
  })

  it('captures style blocks and keeps script/style text out of the tree', () => {
    const doc = parseHtml('<style>.a{color:red}</style><script>const x = "elevate";</script><p>Hello</p>')
    expect(doc.styleBlocks).toHaveLength(1)
    expect(doc.styleBlocks[0].css).toContain('.a{color:red}')
    expect(doc.scriptBlocks).toHaveLength(1)
    const allText = textContent(doc.root)
    expect(allText).not.toContain('elevate')
    expect(allText).toContain('Hello')
  })

  it('tracks element lines', () => {
    const doc = parseHtml('<div>\n  <p>a</p>\n  <p>b</p>\n</div>')
    const p1 = doc.root.children[0].children[0]
    const p2 = doc.root.children[0].children[1]
    expect(p1.line).toBe(2)
    expect(p2.line).toBe(3)
  })

  it('builds nth-of-type paths', () => {
    const doc = parseHtml('<body><section><h1>T</h1><div class="card"><p>X</p></div></section></body>')
    const p = doc.root.children[0].children[0].children[1].children[0]
    const ref = pathOf(p)
    expect(ref).toBe('body:nth-of-type(1) > section:nth-of-type(1) > div.card:nth-of-type(1) > p:nth-of-type(1)')
  })

  it('walks every element', () => {
    const doc = parseHtml('<div><span></span><p><b>x</b></p></div>')
    const tags: string[] = []
    walk(doc.root, (el) => tags.push(el.tag))
    expect(tags).toEqual(['#root', 'div', 'span', 'p', 'b'])
  })

  it('tolerates JSX attributes and self-closing tags', () => {
    const doc = parseHtml('<div className="hero" style={{color: "red"}}><img src="/x.png" /></div>')
    const div = doc.root.children[0]
    expect(div.classes).toEqual(['hero'])
    // JSX object styles are captured but not parsed as CSS.
    expect(div.style).toEqual({})
    const img = div.children[0]
    expect(img.tag).toBe('img')
    expect(img.attrs['src']).toBe('/x.png')
  })

  it('handles void elements and rawtext', () => {
    const doc = parseHtml('<div><img src="a.png"><br><textarea>hello &amp; goodbye</textarea></div>')
    const div = doc.root.children[0]
    expect(div.children.map((c) => c.tag)).toEqual(['img', 'br', 'textarea'])
    expect(div.children[2].text).toBe('hello & goodbye')
  })

  it('decodes entities in text', () => {
    expect(decodeEntities('a &amp; b &lt; c &#39;d&#39;')).toBe('a & b < c \'d\'')
  })

  it('counts newlines', () => {
    expect(countNewlines('a\nb\n\nc')).toBe(3)
  })

  it('parses inline style declarations', () => {
    expect(parseStyle('padding: 4px; color: #fff; background:  linear-gradient(90deg, #7c3aed, #2563eb)'))
      .toEqual({
        padding: '4px',
        color: '#fff',
        background: 'linear-gradient(90deg, #7c3aed, #2563eb)',
      })
  })
})
